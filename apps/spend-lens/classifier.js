// spend-lens — ML-based classifier for the long tail of uncategorized transactions.
//
// Loads sentence-transformers (Xenova/all-MiniLM-L6-v2) via Transformers.js,
// runs inference entirely in the browser. Nothing about your transactions
// is sent to any server.
//
// The model weights are fetched from huggingface.co on first use (~22MB),
// then cached by the browser for all future sessions. Once cached, this
// feature works offline.
//
// Algorithm:
//   1. Embed a handful of exemplar phrases per category.
//   2. Average + normalize exemplars per category → category "centroid" vector.
//   3. For each uncategorized transaction: embed its normalized merchant name.
//   4. Cosine similarity to each centroid. Best match wins.
//   5. If best score < threshold, keep as Uncategorized (honesty over confident-wrong).

(function () {
    'use strict';

    // Small, fast English sentence-transformer. ~22MB, quantized.
    const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

    // Minimum cosine similarity to accept a match. Lower = more assignments
    // but more errors. Tune for your data.
    const SIMILARITY_THRESHOLD = 0.40;

    // Phrases that describe each spending category. Short, merchant-like.
    // Averaged into a centroid vector per category. Fork and tune.
    const CATEGORY_EXEMPLARS = {
        'Food & Drink': [
            'coffee shop', 'cafe espresso', 'restaurant meal', 'pizza place',
            'fast food chain', 'bar and grill', 'food delivery service',
            'lunch spot', 'diner', 'bistro', 'ice cream shop', 'bakery cafe',
            'tavern', 'pub food', 'sushi restaurant', 'mexican cantina'
        ],
        'Groceries': [
            'grocery store', 'supermarket', 'whole foods market',
            'farmers market produce', 'butcher shop', 'fish market',
            'food co-op', 'bulk foods', 'natural foods store'
        ],
        'Shopping': [
            'department store', 'clothing retailer', 'online store order',
            'bookstore', 'electronics store', 'home goods shop',
            'retail purchase', 'shopping outlet', 'furniture store',
            'sporting goods', 'beauty supply', 'hardware store'
        ],
        'Transportation': [
            'gas station fuel', 'filling station', 'rideshare ride',
            'taxi cab', 'parking lot', 'subway metro card',
            'bus pass', 'toll road charge', 'car wash',
            'auto service', 'oil change'
        ],
        'Travel': [
            'hotel booking', 'airline ticket', 'car rental',
            'vacation rental', 'motel stay', 'travel booking site',
            'cruise fare', 'lodging', 'flight fare'
        ],
        'Entertainment': [
            'streaming video service', 'concert tickets', 'movie theater',
            'video game purchase', 'music subscription', 'sports event tickets',
            'amusement park', 'bowling alley', 'arcade games',
            'live show venue'
        ],
        'Bills & Utilities': [
            'electric utility bill', 'internet service provider',
            'phone carrier bill', 'insurance premium payment',
            'rent payment', 'mortgage payment', 'water utility',
            'natural gas utility', 'cable television'
        ],
        'Health & Medical': [
            'pharmacy prescription', 'doctor office visit', 'dental clinic',
            'hospital bill', 'medical center', 'urgent care visit',
            'gym membership', 'yoga studio', 'fitness center',
            'physical therapy clinic', 'vision optometry'
        ],
        'Fees': [
            'bank fee', 'overdraft charge', 'late payment fee',
            'service charge', 'foreign transaction fee', 'atm withdrawal fee',
            'monthly maintenance fee'
        ],
        'Transfers & Payments': [
            'peer to peer money transfer', 'venmo transfer',
            'zelle payment', 'wire transfer', 'bill pay to another account',
            'ach transfer between accounts'
        ]
    };

    let modelPipeline = null;
    let exemplarVectors = null; // { category: { base: [vec...], user: [vec...] } }
    let categoryCentroids = null; // { category: vec } — derived from exemplarVectors
    let loadPromise = null;
    let modelReady = false;

    async function loadTransformers() {
        // Dynamic import — regular <script> tags can't use top-level import.
        return await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    }

    async function embedOne(pipe, text) {
        const out = await pipe(text, { pooling: 'mean', normalize: true });
        return Array.from(out.data);
    }

    function averageAndNormalize(vectors) {
        const dim = vectors[0].length;
        const avg = new Float32Array(dim);
        for (const v of vectors) {
            for (let i = 0; i < dim; i++) avg[i] += v[i];
        }
        for (let i = 0; i < dim; i++) avg[i] /= vectors.length;
        let norm = 0;
        for (let i = 0; i < dim; i++) norm += avg[i] * avg[i];
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < dim; i++) avg[i] /= norm;
        return avg;
    }

    function cosineSimilarityNormalized(a, b) {
        // Both vectors are L2-normalized, so dot product == cosine similarity.
        let s = 0;
        for (let i = 0; i < a.length; i++) s += a[i] * b[i];
        return s;
    }

    function recomputeCentroid(category) {
        const slots = exemplarVectors[category];
        if (!slots) { delete categoryCentroids[category]; return; }
        const all = [...slots.base, ...slots.user];
        if (all.length === 0) { delete categoryCentroids[category]; return; }
        categoryCentroids[category] = averageAndNormalize(all);
    }

    async function embedBaseExemplars(pipe) {
        exemplarVectors = {};
        for (const [cat, phrases] of Object.entries(CATEGORY_EXEMPLARS)) {
            const vecs = [];
            for (const phrase of phrases) vecs.push(await embedOne(pipe, phrase));
            exemplarVectors[cat] = { base: vecs, user: [] };
        }
    }

    async function loadUserExemplars(userExemplarsByCategory) {
        if (!userExemplarsByCategory) return;
        for (const [cat, phrases] of Object.entries(userExemplarsByCategory)) {
            if (!exemplarVectors[cat]) exemplarVectors[cat] = { base: [], user: [] };
            for (const phrase of phrases) {
                exemplarVectors[cat].user.push(await embedOne(modelPipeline, phrase));
            }
        }
    }

    function recomputeAllCentroids() {
        categoryCentroids = {};
        for (const cat of Object.keys(exemplarVectors)) recomputeCentroid(cat);
    }

    async function load(progressCallback, userExemplarsByCategory) {
        if (modelReady) {
            // Already loaded; just merge any new user exemplars.
            if (userExemplarsByCategory) {
                await loadUserExemplars(userExemplarsByCategory);
                recomputeAllCentroids();
            }
            return;
        }
        if (loadPromise) return loadPromise;

        loadPromise = (async () => {
            let transformers;
            try {
                transformers = await loadTransformers();
            } catch (e) {
                loadPromise = null;
                throw new Error('Failed to load Transformers.js — check your network connection.');
            }

            transformers.env.allowLocalModels = false;
            transformers.env.useBrowserCache = true;

            modelPipeline = await transformers.pipeline(
                'feature-extraction',
                MODEL_ID,
                { progress_callback: progressCallback }
            );

            await embedBaseExemplars(modelPipeline);
            await loadUserExemplars(userExemplarsByCategory);
            recomputeAllCentroids();
            modelReady = true;
        })();

        return loadPromise;
    }

    // Add a single user exemplar and recompute that category's centroid.
    // Used by the tag-feedback loop — the model literally learns from corrections.
    async function addUserExemplar(category, phrase) {
        if (!modelReady) return false;
        if (!category || !phrase) return false;
        const vec = await embedOne(modelPipeline, phrase);
        if (!exemplarVectors[category]) exemplarVectors[category] = { base: [], user: [] };
        exemplarVectors[category].user.push(vec);
        recomputeCentroid(category);
        return true;
    }

    async function classify(description) {
        if (!modelReady) throw new Error('Classifier not loaded. Call load() first.');
        const clean = String(description || '').trim();
        if (!clean) return { category: null, score: 0 };

        const vec = await embedOne(modelPipeline, clean);

        let best = null;
        let bestScore = -Infinity;
        for (const [cat, centroid] of Object.entries(categoryCentroids)) {
            const s = cosineSimilarityNormalized(vec, centroid);
            if (s > bestScore) { bestScore = s; best = cat; }
        }

        if (bestScore < SIMILARITY_THRESHOLD) {
            return { category: null, score: bestScore };
        }
        return { category: best, score: bestScore };
    }

    window.SpendLensClassifier = {
        load,
        classify,
        addUserExemplar,
        categories: () => Object.keys(CATEGORY_EXEMPLARS),
        isReady: () => modelReady,
        threshold: SIMILARITY_THRESHOLD,
        modelId: MODEL_ID
    };
})();
