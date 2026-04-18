// spend-lens — merchant categorization rules.
//
// Fully visible, fully forkable. Every rule is a lowercase keyword match
// against the transaction description. Rules are evaluated in order;
// the first match wins, so put more specific patterns higher.
//
// Fork this file and tune for your spending — that's the point of open source.

(function () {
    'use strict';

    const CATEGORY_COLORS = {
        'Food & Drink':         '#e67a6b',
        'Groceries':            '#65bc7b',
        'Shopping':             '#4fc3f7',
        'Transportation':       '#a855f7',
        'Travel':               '#2dd4bf',
        'Entertainment':        '#f97316',
        'Bills & Utilities':    '#fbbf24',
        'Health & Medical':     '#f472b6',
        'Fees':                 '#ef4444',
        'Transfers & Payments': '#94a3b8',
        'Income':               '#86efac',
        'Taxes':                '#d4a017',
        'Loans & Mortgage':     '#7c3aed',
        'Credit Card Payments': '#60a5fa',
        'Checks':               '#9ca3af',
        'Uncategorized':        '#64748b',
        'Other':                '#64748b'
    };

    const CATEGORY_LIST = [
        'Food & Drink', 'Groceries', 'Shopping', 'Transportation',
        'Travel', 'Entertainment', 'Bills & Utilities', 'Health & Medical',
        'Fees', 'Transfers & Payments', 'Income',
        'Taxes', 'Loans & Mortgage', 'Credit Card Payments', 'Checks'
    ];

    // Order matters: more specific rules first.
    const CATEGORY_RULES = [

        // --- Fees (put first; obvious signal) ---
        { category: 'Fees', keywords: [
            'late fee', 'overdraft', 'nsf', 'service fee', 'foreign transaction',
            'atm fee', 'wire fee', 'annual fee', 'maintenance fee', 'returned item',
            'insufficient funds'
        ]},

        // --- Taxes (IRS, state, property — before Bills so "city of" property tax lands here) ---
        { category: 'Taxes', keywords: [
            'irs usataxpymt', 'irs ', 'usataxpymt', 'us treasury', 'ustreasury',
            'franchise tax', 'state tax', 'dept of revenue', 'dept of taxation',
            'property tax', 'prop tax', 'tax collector', 'county tax',
            'federal tax', 'estimated tax', 'fed tax pmt'
        ]},

        // --- Credit Card Payments (card payoffs from checking — before Transfers) ---
        { category: 'Credit Card Payments', keywords: [
            'american express ach', 'amex epayment', 'amex epayent', 'amex ach',
            'chase credit crd', 'chase card', 'chase epay',
            'citi card', 'citibank card', 'citi autopay',
            'discover e-payment', 'discover epay',
            'capital one crcardpmt', 'capital one autopay', 'capital one card',
            'comenity pay', 'comenity web',
            'applecard gsbank', 'applecard', 'gs bank apple',
            'synchrony bank pymt', 'synchrony card', 'syf payment', 'mstrcrd syf',
            'barclays card', 'barclaycard',
            'bank of america credit', 'boa creditcard',
            'wells fargo credit', 'wf credit card',
            'payment to chase card', 'payment to amex', 'payment to citi',
            'credit card payment', 'credit card pmt', 'cc payment'
        ]},

        // --- Loans & Mortgage (mortgage servicers, personal loans, student loans) ---
        { category: 'Loans & Mortgage', keywords: [
            'pennymac', 'mr cooper', 'nationstar', 'rocket mortgage',
            'wells fargo home', 'chase mortgage', 'bofa mortgage',
            'freedom mortgage', 'loanDepot', 'loandepot', 'caliber home',
            'lendingpoint', 'lending point', 'sofi loan', 'upstart',
            'avant loan', 'prosper loan', 'marcus loan',
            'nelnet', 'great lakes', 'mohela', 'navient', 'fedloan',
            'mortgage payment', 'mortgage pmt', 'home loan payment',
            'auto loan', 'car loan payment', 'loan payment ppd'
        ]},

        // --- Checks (paper checks — rarely categorizable from description alone) ---
        { category: 'Checks', keywords: [
            'check paid #', 'check #', 'check paid', 'paper check',
            'deposited check'
        ]},

        // --- Income (paychecks, deposits, refunds) ---
        { category: 'Income', keywords: [
            'payroll', 'direct deposit', 'salary', 'dir dep', 'adp payroll',
            'intuit paycheck', 'ach deposit', 'refund', 'rebate', 'cashback'
        ]},

        // --- Transfers & Payments ---
        { category: 'Transfers & Payments', keywords: [
            'venmo', 'zelle', 'paypal', 'cash app', 'cashapp', 'squarecash',
            'transfer to', 'transfer from', 'payment thank you', 'autopay',
            'online payment', 'check #', 'check paid'
        ]},

        // --- Groceries (before Shopping so Target Grocery doesn't hit Shopping) ---
        { category: 'Groceries', keywords: [
            'whole foods', 'trader joe', 'trader joes', 'kroger', 'publix',
            'safeway', 'wegmans', 'aldi', 'winn-dixie', 'winn dixie', 'giant eagle',
            'food lion', 'stop & shop', 'stop and shop', 'shoprite', 'shop rite',
            'sprouts', "sam's club", 'sams club', 'costco whse', 'walmart grocery',
            'h-e-b', 'heb ', 'meijer', 'harris teeter', 'fred meyer', 'food 4 less',
            'fresh market', 'grocery'
        ]},

        // --- Food & Drink (coffee, restaurants, fast food, delivery) ---
        { category: 'Food & Drink', keywords: [
            'starbucks', 'dunkin', 'peets coffee', 'blue bottle', 'caribou',
            'tim hortons', 'philz',
            'chipotle', 'panera', 'subway', 'mcdonald', 'burger king', 'chick-fil-a',
            'chick fil a', 'wendys', "wendy's", 'taco bell', 'kfc', 'popeyes',
            'arbys', "arby's", 'five guys', 'shake shack', 'panda express', 'chopt',
            'sweetgreen', 'cava', 'qdoba',
            'doordash', 'ubereats', 'uber eats', 'grubhub', 'postmates', 'seamless',
            ' restaurant', ' bar ', ' cafe', ' café', ' diner', ' bistro', ' grill',
            'pizza', 'sushi', 'ramen', 'thai', 'mexican', 'chinese', 'indian food'
        ]},

        // --- Transportation (gas + ride-share + transit) ---
        { category: 'Transportation', keywords: [
            'shell oil', 'shell service', 'shell gas', 'chevron', 'exxon', 'mobil',
            'bp ', 'bp#', '76 gas', 'arco', 'conoco', 'phillips 66', 'valero',
            'marathon pet', 'speedway', 'circle k', 'sunoco', 'quiktrip', 'racetrac',
            'sheetz', 'wawa', '7-eleven',
            'uber trip', 'uber *trip', 'lyft ', 'lyft*', 'taxi', 'yellow cab',
            'metro transit', 'mta ', 'bart', 'caltrain', 'septa', 'path transit',
            'amtrak', 'greyhound', 'megabus'
        ]},

        // --- Travel (airlines, hotels, tolls, booking sites) ---
        { category: 'Travel', keywords: [
            'delta air', 'american airlines', 'united airlines', 'southwest air',
            'jetblue', 'alaska air', 'spirit airl', 'frontier air', 'hawaiian air',
            'lufthansa', 'british airways', 'air france', 'klm',
            'marriott', 'hilton', 'hyatt', 'hampton inn', 'holiday inn',
            'best western', 'sheraton', 'westin', 'doubletree', 'courtyard',
            'airbnb', 'booking.com', 'expedia', 'vrbo', 'hotels.com', 'kayak',
            'priceline', 'orbitz', 'travelocity',
            'toll road', 'ezpass', 'e-zpass', 'sunpass', 'fastrak', 'pike pass',
            'parking', 'park mobile', 'parkmobile'
        ]},

        // --- Entertainment (streaming, games, events) ---
        { category: 'Entertainment', keywords: [
            'netflix', 'hulu', 'disney plus', 'disneyplus', 'paramount+', 'paramount plus',
            'hbo max', 'hbomax', 'peacock', 'youtube tv', 'youtubetv', 'apple tv',
            'apple.com/bill', 'spotify', 'apple music', 'pandora', 'sirius', 'siriusxm',
            'tidal', 'audible',
            'amc theatres', 'regal cinema', 'cinemark', 'movie theater',
            'ticketmaster', 'stubhub', 'seatgeek', 'vivid seats', 'eventbrite',
            'steam games', 'steampowered', 'xbox', 'playstation', 'nintendo',
            'twitch', 'patreon', 'substack'
        ]},

        // --- Bills & Utilities (rent, internet, phone, power) ---
        { category: 'Bills & Utilities', keywords: [
            'rent payment', 'hoa ', 'city of ', 'town of ', 'village of ',
            'at&t', 'att*bill', 'verizon', 'vzwrlss', 'vzw wless', 't-mobile',
            'tmobile', 'sprint', 'xfinity', 'comcast', 'spectrum', 'cox comm',
            'rcn ', 'frontier comm', 'centurylink',
            'pg&e', 'coned', 'con edison', 'duke energy', 'southern california edison',
            'sce ', 'dominion energy', 'national grid', 'xcel energy', 'water dept',
            'water and sewer', 'electric bill', 'power bill',
            'geico', 'state farm', 'progressive ins', 'allstate', 'liberty mutual',
            'usaa ins', 'nationwide ins', 'farmers ins', 'aaa '
        ]},

        // --- Health & Medical ---
        { category: 'Health & Medical', keywords: [
            'cvs pharmacy', 'cvs/pharmacy', 'walgreens', 'rite aid', ' pharmacy',
            'hospital', 'medical center', 'clinic', 'urgent care', 'dental',
            'dentist', 'orthodontist', 'eye care', 'optical', 'vision care',
            'blue cross', 'aetna', 'unitedhealth', 'cigna', 'humana', 'kaiser',
            'fitness', 'planet fitness', 'la fitness', '24 hour fitness',
            'crossfit', 'equinox', 'soulcycle', 'orangetheory', 'orange theory',
            'yoga ', 'pilates'
        ]},

        // --- Shopping (general retail, online, home) ---
        { category: 'Shopping', keywords: [
            'amzn', 'amazon.com', 'amazon mktp', 'amazon prime', 'amzn mktp',
            'ebay', 'etsy',
            'target.com', 'target ', 'target t-', 'walmart.com', 'walmart store',
            'wmt ', 'best buy', 'bestbuy',
            'home depot', 'lowes', 'lowe\'s', 'ikea', 'wayfair', 'ace hardware',
            'macys', "macy's", 'nordstrom', 'kohls', "kohl's", 'tj maxx', 'tjmaxx',
            'marshalls', 'ross store', 'ross dress', 'dillards', "dillard's",
            'apple store', 'apple.com', 'bh photo', 'newegg', 'microcenter',
            'sephora', 'ulta'
        ]}
    ];

    function categorizeDescription(description, bankCategory) {
        const desc = (description || '').toLowerCase();
        if (!desc) return 'Uncategorized';

        for (const rule of CATEGORY_RULES) {
            for (const kw of rule.keywords) {
                if (desc.includes(kw)) return rule.category;
            }
        }

        // Fall back to the bank's own category column if it provided one.
        if (bankCategory) {
            const bc = bankCategory.trim();
            if (bc && bc.toLowerCase() !== 'sale' && bc.toLowerCase() !== 'payment') {
                return bc;
            }
        }

        return 'Uncategorized';
    }

    // Expose on window for script.js to consume. Tiny surface on purpose.
    window.SpendLensCategories = {
        categorize: categorizeDescription,
        colors: CATEGORY_COLORS,
        list: CATEGORY_LIST,
        rules: CATEGORY_RULES // exposed for debugging / "why this category?" UX later
    };
})();
