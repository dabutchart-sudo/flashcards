// ===================================================================
// app.js — NO-IMPORT EDITION (Guaranteed to Run)
// ===================================================================

// --- 1. PASTE YOUR KEYS HERE (Inside the quotes) ---
const SUPABASE_URL = "https://dntitlrtvkgisxwqjxch.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudGl0bHJ0dmtnaXN4d3FqeGNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxOTQ0MzEsImV4cCI6MjA3OTc3MDQzMX0.S9CXEsHoqp9ATaX23nLI77Q78SvVUSp9V30U-MNcm90";
const UNSPLASH_ACCESS_KEY = "roF6le_ubyOne6ys-UrkyHpl0afaLEvVeiNOq9ifsnM";

// --- Configuration ---
const CONFIG_MAX_NEW = "dutch_max_new_v1";
const APP_VERSION = "2.1";

// --- Initialize Global Libraries ---
// We use window.supabase because we loaded it via <script> tag in index.html
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const { createApp } = Vue;

const app = createApp({
    data() {
        return {
            appVersion: APP_VERSION,
            currentScreen: 'menu',
            
            // State
            allCards: [],
            reviewHistory: [],
            reviewBuffer: [],
            
            // Session
            sessionQueue: [],
            sessionTotal: 0,
            currentIndex: 0,
            isFlipped: false,
            disableTransition: false, 
            showHint: false,
            processingRating: false,

            // Image Selection
            imgSearchQuery: '',
            imgResults: [],
            imgLoading: false,
            selectedImageUrl: null,
            imageReturnScreen: 'learn',
            cardForImage: null,

            // Word Review Filter
            wordSearch: '',
            wordFilter: 'all',
            sortCol: 'dutch',

            // Settings
            settingsMaxNew: '10',

            // Report
            reportGroup: 'day',
            
            // Loading Overlay
            loading: {
                show: true,
                msg: 'Starting...'
            }
        };
    },
    computed: {
        // --- Progress Stats ---
        stats() {
            try {
                if (!this.allCards) return { doneNew:0, doneReview:0, dueNew:0, dueReview:0, tomorrowNew:0, tomorrowReview:0 };

                const now = new Date();
                const today = now.toISOString().slice(0, 10);
                const tomorrow = new Date(now);
                tomorrow.setDate(now.getDate() + 1);
                const tomorrowStr = tomorrow.toISOString().slice(0, 10);

                const maxNew = parseInt(this.settingsMaxNew || 10);

                // Done Today
                const newDone = this.allCards.filter(c => 
                    !c.suspended && c.first_seen && c.first_seen.slice(0, 10) === today
                ).length;

                // Safety check for reviewHistory/Buffer
                const safeHistory = Array.isArray(this.reviewHistory) ? this.reviewHistory : [];
                const safeBuffer = Array.isArray(this.reviewBuffer) ? this.reviewBuffer : [];
                const allLogs = [...safeHistory, ...safeBuffer];

                const revDone = allLogs.filter(h => 
                    h.timestamp && h.timestamp.startsWith(today) && h.review_type === 'review'
                ).length;

                // Due Today
                const newDue = Math.max(0, maxNew - newDone);
                const revDue = this.allCards.filter(c =>
                    !c.suspended && c.type !== "new" && c.due_date && c.due_date.slice(0, 10) <= today
                ).length;

                // Due Tomorrow
                const revDueTom = this.allCards.filter(c => 
                    !c.suspended && c.type !== "new" && c.due_date && c.due_date.slice(0, 10) === tomorrowStr
                ).length;

                return {
                    doneNew: newDone,
                    doneReview: revDone,
                    dueNew: newDue,
                    dueReview: revDue,
                    tomorrowNew: maxNew,
                    tomorrowReview: revDueTom
                };
            } catch (e) {
                console.error("Stats Error:", e);
                return { doneNew:0, doneReview:0, dueNew:0, dueReview:0, tomorrowNew:0, tomorrowReview:0 };
            }
        },

        // --- Session ---
        currentCard() {
            return this.sessionQueue[this.currentIndex] || null;
        },
        sessionStarted() {
            return this.sessionTotal > 0;
        },
        progressPercent() {
            if (!this.sessionTotal) return 0;
            const completed = this.sessionTotal - this.sessionQueue.length;
            return (completed / this.sessionTotal) * 100;
        },
        progressText() {
            if (!this.sessionTotal) return "0 / 0";
            const completed = this.sessionTotal - this.sessionQueue.length;
            return `${Math.min(completed + 1, this.sessionTotal)} / ${this.sessionTotal}`;
        },

        // --- Word Review List ---
        filteredWords() {
            const today = new Date().toISOString().slice(0, 10);
            const search = (this.wordSearch || '').toLowerCase().trim();
            
            if (!this.allCards) return [];

            let list = this.allCards.filter(c => {
                const dutch = c.dutch || '';
                const english = c.english || '';
                
                const match = dutch.toLowerCase().includes(search) || english.toLowerCase().includes(search);
                if (!match) return false;
                
                if (this.wordFilter === 'suspended') return c.suspended;
                if (c.suspended) return false;

                if (this.wordFilter === 'new') return c.type === 'new';
                if (this.wordFilter === 'due') {
                    return (c.type !== 'new' && c.due_date && c.due_date.slice(0,10) <= today);
                }
                return true;
            });

            // Sorting
            list.sort((a, b) => {
                const va = a[this.sortCol] || "";
                const vb = b[this.sortCol] || "";
                if (this.sortCol === 'dutch' || this.sortCol === 'english') {
                    return va.localeCompare(vb);
                }
                return va > vb ? 1 : -1;
            });

            return list;
        }
    },
    async mounted() {
        await this.init();
    },
    methods: {
        // -------------------------
        // INIT & LOADING
        // -------------------------
        async init() {
            try {
                this.loading = { show: true, msg: 'Checking Keys...' };
                
                // 1. Check keys
                if (SUPABASE_URL.includes("PASTE_YOUR")) {
                    throw new Error("Please open app.js and paste your Supabase Keys at the top!");
                }

                this.settingsMaxNew = localStorage.getItem(CONFIG_MAX_NEW) || "10";
                
                // 2. Load Cards
                this.loading.msg = 'Loading Cards...';
                let { data: cards, error: cardError } = await supabase.from("cards").select("*").range(0, 9999);
                if (cardError) throw new Error("Card Fetch: " + cardError.message);
                
                this.allCards = cards || [];
                
                // 3. Load History
                this.loading.msg = 'Loading History...';
                let { data: hist, error: histError } = await supabase.from("reviewhistory").select("*");
                if (histError) throw new Error("History Fetch: " + histError.message);
                
                this.reviewHistory = hist || [];

                // 4. Load Google Charts
                if (window.google && google.charts) {
                    try {
                        google.charts.load("current", { packages: ["corechart"] });
                    } catch(e) { console.warn("Google Charts load failed", e); }
                }

                // Success!
                this.loading.show = false;

            } catch (err) {
                // SHOW THE ERROR ON SCREEN
                this.loading.msg = "Error: " + (err.message || err);
                console.error(err);
                alert("App Error: " + (err.message || err));
            }
        },

        // -------------------------
        // NAVIGATION
        // -------------------------
        async nav(screenId) {
            if (screenId === 'menu') {
                await this.returnToMenu();
            } else {
                this.currentScreen = screenId;
                if (screenId === 'learn') this.startSession();
                if (screenId === 'report') this.renderCharts();
            }
        },
        async returnToMenu() {
            this.loading = { show: true, msg: 'Saving progress...' };

            if (this.reviewBuffer.length > 0) {
                const toSend = [...this.reviewBuffer];
                this.reviewHistory.push(...toSend);
                this.reviewBuffer = [];
                
                await this.flushReviewHistory(toSend);
                await this.updateScheduledCards(toSend);
            }

            // Re-sync cards to be safe
            let { data } = await supabase.from("cards").select("*").range(0, 9999);
            if (data) this.allCards = data;

            // Save settings
            localStorage.setItem(CONFIG_MAX_NEW, this.settingsMaxNew);

            this.currentScreen = 'menu';
            this.loading.show = false;
        },

        // -------------------------
        // LEARNING SESSION
        // -------------------------
        startSession() {
            const today = new Date().toISOString().slice(0, 10);
            const maxNew = parseInt(this.settingsMaxNew);
            
            const newDone = this.allCards.filter(c => 
                !c.suspended && c.first_seen && c.first_seen.slice(0, 10) === today
            ).length;

            const due = this.allCards.filter(c =>
                !c.suspended && c.type !== "new" && c.due_date && c.due_date.slice(0, 10) <= today
            );

            const newLimit = Math.max(0, maxNew - newDone);
            let newCards = this.allCards.filter(c => !c.suspended && c.type === "new");
            
            // Randomize and slice new cards
            newCards.sort(() => Math.random() - 0.5);
            newCards = newCards.slice(0, newLimit);

            this.sessionQueue = [...due, ...newCards];
            this.sessionQueue.sort(() => Math.random() - 0.5); // Shuffle session

            this.sessionTotal = this.sessionQueue.length;
            this.currentIndex = 0;
            this.resetCardState();
        },

        resetCardState() {
            // Anti-cheat
            this.disableTransition = true;
            this.isFlipped = false;
            this.showHint = false;
            
            this.$nextTick(() => {
                setTimeout(() => {
                    this.disableTransition = false;
                }, 50); 
            });
        },

        flipCard() {
            this.isFlipped = !this.isFlipped;
        },
        toggleHint() {
            this.showHint = !this.showHint;
        },
        speakTTS() {
            if (!this.currentCard) return;
            const clean = this.currentCard.dutch.replace(/\(.*\)/g, "").trim();
            if ("speechSynthesis" in window) {
                window.speechSynthesis.cancel();
                const u = new SpeechSynthesisUtterance(clean);
                u.lang = "nl-NL";
                window.speechSynthesis.speak(u);
            }
        },

        // -------------------------
        // RATING ALGORITHM
        // -------------------------
        async rate(rating) {
            if (this.processingRating || !this.currentCard) return;
            this.processingRating = true;

            const card = this.currentCard;
            const now = new Date().toISOString();
            const typeAtReview = card.type;

            card.reps = (card.reps || 0) + 1;

            // Scheduling Logic
            const today = now.slice(0, 10);
            
            if (card.type === "new") {
                card.type = "review";
                card.ease = 2.5;
                card.interval = 1;
                card.first_seen = today;
            }

            if (rating === "again") {
                card.lapses = (card.lapses || 0) + 1;
                card.interval = 1;
                card.ease = Math.max(1.3, card.ease - 0.2);
            } else if (rating === "hard") {
                card.interval = Math.max(1, Math.round(card.interval * 1.2));
                card.ease = Math.max(1.3, card.ease - 0.1);
            } else if (rating === "good") {
                card.interval = Math.round(card.interval * card.ease);
            } else if (rating === "easy") {
                card.interval = Math.round(card.interval * (card.ease + 0.15));
                card.ease += 0.1;
            }

            const due = new Date();
            due.setDate(due.getDate() + card.interval);
            card.due_date = due.toISOString();
            card.last_reviewed = today;

            // Log Review
            const reviewLog = {
                cardid: card.id,
                rating,
                timestamp: now,
                reps: card.reps,
                lapses: card.lapses || 0,
                interval: card.interval,
                ease: card.ease,
                review_type: typeAtReview
            };

            this.reviewBuffer.push(reviewLog);
            
            // Remove from queue
            this.sessionQueue.splice(this.currentIndex, 1);
            
            // Update local main list immediately
            const mainIdx = this.allCards.findIndex(c => c.id === card.id);
            if (mainIdx !== -1) this.allCards[mainIdx] = { ...card };

            // Batch Save check
            if (this.reviewBuffer.length >= 5) {
                const toSend = [...this.reviewBuffer];
                this.reviewBuffer = []; // Clear local buffer
                this.flushReviewHistory(toSend);
                this.updateScheduledCards(toSend);
            }

            this.resetCardState();
            this.processingRating = false;
        },

        async flushReviewHistory(list) {
            await supabase.from("reviewhistory").insert(list);
        },
        async updateScheduledCards(list) {
            for (const r of list) {
                const card = this.allCards.find(c => c.id === r.cardid);
                if (!card) continue;
                // Only updating fields that changed
                await supabase.from("cards").update({
                    type: card.type,
                    interval: card.interval,
                    ease: card.ease,
                    last_reviewed: card.last_reviewed,
                    due_date: card.due_date,
                    first_seen: card.first_seen,
                    reps: card.reps,
                    lapses: card.lapses
                }).eq("id", card.id);
            }
        },

        // -------------------------
        // IMAGE SEARCH
        // -------------------------
        openImageSelector(fromScreen, cardOverride = null) {
            this.imageReturnScreen = fromScreen;
            this.cardForImage = cardOverride || this.currentCard;
            this.imgSearchQuery = this.cardForImage.english;
            this.imgResults = [];
            this.selectedImageUrl = null;
            this.currentScreen = 'selectImage';
            this.searchImages();
        },
        exitImageSelector() {
            this.currentScreen = this.imageReturnScreen;
        },
        async searchImages() {
            if (!this.imgSearchQuery) return;
            this.imgLoading = true;
            this.imgResults = [];
            
            try {
                const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(this.imgSearchQuery)}&per_page=12&client_id=${UNSPLASH_ACCESS_KEY}`;
                const res = await fetch(url);
                const json = await res.json();
                this.imgResults = json.results || [];
            } catch (e) {
                console.error(e);
            } finally {
                this.imgLoading = false;
            }
        },
        async saveSelectedImage() {
            if (!this.selectedImageUrl || !this.cardForImage) return;
            
            // Update Local
            this.cardForImage.image_url = this.selectedImageUrl;
            const idx = this.allCards.findIndex(c => c.id === this.cardForImage.id);
            if (idx !== -1) this.allCards[idx].image_url = this.selectedImageUrl;

            // Update Remote
            await supabase.from("cards").update({ image_url: this.selectedImageUrl }).eq("id", this.cardForImage.id);
            
            this.exitImageSelector();
        },

        // -------------------------
        // WORD TOOLS
        // -------------------------
        async toggleSuspend(card) {
            card.suspended = !card.suspended;
            await supabase.from("cards").update({ suspended: card.suspended }).eq("id", card.id);
        },
        isDue(dateStr) {
            if (!dateStr) return false;
            const today = new Date().toISOString().slice(0, 10);
            return dateStr.slice(0, 10) <= today;
        },
        formatDateShort(dateStr) {
            if (!dateStr) return '-';
            return dateStr.slice(5, 10);
        },

        // -------------------------
        // CHARTS
        // -------------------------
        renderCharts() {
            // Delay slightly to let the div render
            setTimeout(() => {
                this.drawStatusChart();
                this.drawMasteryHistory();
                this.drawActivityChart();
            }, 100);
        },
        drawStatusChart() {
            let stats = { new: 0, learning: 0, reviewing: 0, mastered: 0 };
            this.allCards.forEach(c => {
                if (c.suspended) return;
                if (c.type === 'new') stats.new++;
                else {
                    const ivl = c.interval || 0;
                    if (ivl <= 3) stats.learning++;
                    else if (ivl <= 21) stats.reviewing++;
                    else stats.mastered++;
                }
            });

            const data = google.visualization.arrayToDataTable([
                ['Status', 'Count'],
                ['New', stats.new],
                ['Learning', stats.learning],
                ['Reviewing', stats.reviewing],
                ['Mastered', stats.mastered]
            ]);

            const options = {
                pieHole: 0.4,
                colors: ['#ADB5BD', '#FFCA3A', '#1982C4', '#8AC926'], 
                chartArea: { width: "90%", height: "85%" },
                legend: { position: 'bottom' }
            };

            const chart = new google.visualization.PieChart(document.getElementById('status-chart-div'));
            chart.draw(data, options);
        },
        
        drawMasteryHistory() {
            const cardMap = new Map();
            this.allCards.forEach(c => {
                if (!c.suspended) cardMap.set(c.id, { 
                    status: c.type, interval: c.interval || 0, ease: c.ease || 2.5 
                });
            });

            const sortedHistory = [...this.reviewHistory].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            if (sortedHistory.length === 0) return;

            const dailyStats = [];
            let currentDate = sortedHistory[0].timestamp.slice(0, 10);
            const today = new Date().toISOString().slice(0, 10);

            // Replay helper
            const takeSnapshot = (dateStr) => {
                let s = { new:0, learning:0, reviewing:0, mastered:0 };
                for (const [id, state] of cardMap.entries()) {
                    if (state.status === 'new') s.new++;
                    else if (state.interval <= 3) s.learning++;
                    else if (state.interval <= 21) s.reviewing++;
                    else s.mastered++;
                }
                const [y, m, d] = dateStr.split("-").map(Number);
                dailyStats.push([new Date(y, m-1, d), s.new, s.learning, s.reviewing, s.mastered]);
            };

            let idx = 0;
            while (currentDate <= today) {
                while (idx < sortedHistory.length) {
                    const evt = sortedHistory[idx];
                    if (evt.timestamp.slice(0, 10) > currentDate) break;
                    idx++;
                }
                takeSnapshot(currentDate); 
                const d = new Date(currentDate);
                d.setDate(d.getDate() + 1);
                currentDate = d.toISOString().slice(0, 10);
            }

            const data = new google.visualization.DataTable();
            data.addColumn('date', 'Date');
            data.addColumn('number', 'New');
            data.addColumn('number', 'Learning');
            data.addColumn('number', 'Reviewing');
            data.addColumn('number', 'Mastered');
            data.addRows(dailyStats);

            const chart = new google.visualization.AreaChart(document.getElementById('mastery-history-chart'));
            chart.draw(data, { 
                isStacked: true, 
                colors: ['#ADB5BD', '#FFCA3A', '#1982C4', '#8AC926'],
                legend: { position: 'bottom' },
                hAxis: { format: 'MMM d' },
                vAxis: { textPosition: 'none', gridlines: { count: 0 } },
                chartArea: { width: "85%", height: "70%" }
            });
        },

        drawActivityChart() {
            const data = new google.visualization.DataTable();
            data.addColumn("date", "Date");
            data.addColumn("number", "New");
            data.addColumn("number", "Review");

            const group = this.reportGroup;
            let options = {
                isStacked: true,
                legend: { position: "bottom" },
                colors: ["#FF9F1C", "#1a80d9"],
                chartArea: { width: "85%", height: "70%" },
                vAxis: { viewWindow: { min: 0 } }
            };

            if (group === 'day') {
                const today = new Date();
                const start = new Date(today.getFullYear(), today.getMonth(), 1);
                const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                const map = new Map();
                
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    map.set(d.toISOString().slice(0, 10), { new:0, rev:0, date: new Date(d) });
                }

                this.reviewHistory.forEach(h => {
                    const k = h.timestamp.slice(0, 10);
                    if (map.has(k)) {
                        if (h.review_type === 'new') map.get(k).new++;
                        else map.get(k).rev++;
                    }
                });

                for (const val of map.values()) {
                    data.addRow([val.date, val.new, val.rev]);
                }
                options.hAxis = { format: 'd', gridlines: { color: 'transparent' }, ticks: [] };
                options.bar = { groupWidth: '90%' };
            } else {
                 const map = {};
                 this.reviewHistory.forEach(h => {
                    let k = h.timestamp.slice(0, 10);
                    if (group === 'month') k = k.slice(0, 7);
                    if (group === 'year') k = k.slice(0, 4);
                    if (!map[k]) map[k] = { new: 0, rev: 0 };
                    if (h.review_type === 'new') map[k].new++;
                    else map[k].rev++;
                 });
                 Object.keys(map).sort().forEach(k => {
                     const parts = k.split("-").map(Number);
                     const d = new Date(parts[0], (parts[1]||1)-1, parts[2]||1);
                     data.addRow([d, map[k].new, map[k].rev]);
                 });
            }

            const chart = new google.visualization.ColumnChart(document.getElementById("chart-div"));
            chart.draw(data, options);
        }
    }
});

// GLOBAL ERROR HANDLER
app.config.errorHandler = (err, instance, info) => {
    console.error("Vue Crash:", err);
    alert("System Error: " + err.message + "\nInfo: " + info);
};

app.mount('#app');
