import { firebaseConfig } from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, getDocs, getDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ==========================================
// 0. FIREBASE INITIALIZATION & AUTH
// ==========================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let userId = null;

signInAnonymously(auth).catch((error) => {
    console.error("Firebase Auth Error:", error.code, error.message);
});

onAuthStateChanged(auth, (user) => {
    if (user) {
        userId = user.uid;
        console.log("Player ID initialized:", userId);
    }
});

// ==========================================
// 1. GAME STATE, CONSTANTS & EN ISOLATION
// ==========================================

// İngilizce versiyona özel hafıza ve veritabanı yolları
const STORAGE_KEYS = {
    STATE: 'gridMaster_dailyState_EN',
    STATS: 'gridMaster_playerStats_EN',
    THEME: 'gridMaster_theme_EN'
};

const COLLECTIONS = {
    SCORES: 'dailyScores_EN',
    PLAYER_STATS: 'playerStats_EN'
};

let dictionary = new Set();
let gridData = Array(25).fill(null);
let dailySequence = [];
let currentMove = 0;
let isGameActive = false;
let draftIndex = null;
let jokerLetter = null;
let currentPlayingDate = new Date();

const LETTER_POOL = {
    'A': 9, 'B': 2, 'C': 2, 'D': 4, 'E': 12, 'F': 2, 'G': 3, 'H': 2,
    'I': 9, 'J': 1, 'K': 1, 'L': 4, 'M': 2, 'N': 6, 'O': 8, 'P': 2,
    'Q': 1, 'R': 6, 'S': 4, 'T': 6, 'U': 4, 'V': 2, 'W': 2, 'X': 1,
    'Y': 2, 'Z': 1
};

const VOWELS = ['A', 'E', 'I', 'O', 'U'];
const SCORE_RULES = { 2: 2, 3: 5, 4: 9, 5: 15 };

// DOM Elements
const gridEl = document.getElementById('grid');
const currentLetterBox = document.getElementById('current-letter-box');
const actionMessage = document.getElementById('action-message');
const dateDisplay = document.getElementById('date-display');
const challengeDisplay = document.getElementById('challenge-display');
const jokerKeyboard = document.getElementById('joker-keyboard');
const wordsListContainer = document.getElementById('words-list-container');
const dictModal = document.getElementById('dictionary-modal');
const closeModalBtn = document.getElementById('close-modal');
const modalTitle = document.getElementById('modal-word-title');
const modalDef = document.getElementById('modal-word-def');

// ==========================================
// 2. INITIALIZATION & STATE RECOVERY
// ==========================================
async function initGame() {
    try {
        actionMessage.textContent = "Loading dictionary...";
        const response = await fetch('words.json');
        if (!response.ok) throw new Error("Failed to load dictionary");
        const wordsArray = await response.json();
        dictionary = new Set(wordsArray.map(w => w.toUpperCase()));
        
        setupDailyContext();
        loadGameState();
        
        renderGrid();
        updateUI();
        
        if (currentMove < 25) {
            isGameActive = true;
            document.body.classList.add('game-locked'); 
            actionMessage.textContent = "Tap a cell to draft, tap again to place.";
        } else {
            document.body.classList.remove('game-locked');
            calculateAndSaveScore();
        }
        
    } catch (error) {
        console.error("Initialization Error:", error);
        actionMessage.textContent = "Error loading game data.";
    }
}

function getLocalDateStr(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function loadGameState() {
    const savedState = localStorage.getItem(STORAGE_KEYS.STATE);
    if (savedState) {
        const state = JSON.parse(savedState);
        const parts = state.dateStr.split('-');
        currentPlayingDate = new Date(parts[0], parts[1] - 1, parts[2]);
        gridData = state.grid;
        currentMove = state.move;
    } else {
        currentPlayingDate = new Date();
    }
}

function saveGameState() {
    const state = {
        dateStr: getLocalDateStr(currentPlayingDate),
        grid: gridData,
        move: currentMove
    };
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
}

// ==========================================
// 3. DAILY SEEDED RNG LOGIC
// ==========================================
function setupDailyContext() {
    const options = { month: 'long', day: 'numeric', year: 'numeric' };
    dateDisplay.textContent = currentPlayingDate.toLocaleDateString('en-US', options);
    
    const startDate = new Date("2026-03-06T00:00:00");
    const startMidnight = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const currentMidnight = new Date(currentPlayingDate.getFullYear(), currentPlayingDate.getMonth(), currentPlayingDate.getDate());
    
    const diffTime = Math.abs(currentMidnight - startMidnight);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    challengeDisplay.textContent = `No. ${diffDays}`;
    
    const seed = (currentPlayingDate.getFullYear() * 10000) + ((currentPlayingDate.getMonth() + 1) * 100) + currentPlayingDate.getDate();
    dailySequence = generateDailyLetters(seed);
}

function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

function generateDailyLetters(seed) {
    const random = mulberry32(seed);
    let vowelPool = [];
    let consonantPool = [];
    
    for (let [letter, count] of Object.entries(LETTER_POOL)) {
        for (let i = 0; i < count; i++) {
            if (VOWELS.includes(letter)) vowelPool.push(letter);
            else consonantPool.push(letter);
        }
    }
    
    const shuffle = (array) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    };
    
    shuffle(vowelPool);
    shuffle(consonantPool);
    
    let finalSequence = [];
    finalSequence.push(...vowelPool.slice(0, 10));
    finalSequence.push(...consonantPool.slice(0, 14));
    shuffle(finalSequence);
    
    return finalSequence;
}

// ==========================================
// 4. UI RENDERING & TAP-TO-CONFIRM
// ==========================================
function renderGrid() {
    gridEl.innerHTML = '';
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        
        if (gridData[i] !== null) {
            cell.textContent = gridData[i];
            cell.setAttribute('data-state', 'filled');
        } else if (i === draftIndex) {
            cell.textContent = currentMove === 24 ? jokerLetter : dailySequence[currentMove];
            cell.setAttribute('data-state', 'draft');
            cell.addEventListener('click', () => handleCellClick(i));
        } else {
            cell.setAttribute('data-state', 'empty');
            cell.addEventListener('click', () => handleCellClick(i));
        }
        gridEl.appendChild(cell);
    }
}

function renderKeyboard() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');
    jokerKeyboard.innerHTML = '';
    alphabet.forEach(letter => {
        const btn = document.createElement('button');
        btn.className = 'key-btn';
        btn.textContent = letter;
        
        if (jokerLetter === letter) btn.classList.add('selected');
        
        btn.addEventListener('click', () => {
            jokerLetter = letter;
            if (draftIndex === null) {
                draftIndex = gridData.indexOf(null);
            }
            renderKeyboard();
            renderGrid();
            updateUI();
        });
        jokerKeyboard.appendChild(btn);
    });
}

function updateUI() {
    if (currentMove < 24) {
        currentLetterBox.textContent = dailySequence[currentMove];
        currentLetterBox.classList.remove('hidden');
        jokerKeyboard.classList.add('hidden');
        
        if (draftIndex !== null) {
            actionMessage.textContent = "Tap again to place.";
        } else {
            actionMessage.textContent = "Tap a cell to draft your letter.";
        }
    } else if (currentMove === 24) {
        currentLetterBox.classList.add('hidden');
        jokerKeyboard.classList.remove('hidden');
        if (draftIndex !== null && jokerLetter !== null) {
            actionMessage.textContent = "Tap the grid cell again to finish the game.";
        } else {
            actionMessage.textContent = "Choose your final letter from the keyboard.";
            renderKeyboard();
        }
    } else {
        currentLetterBox.classList.add('hidden');
        jokerKeyboard.classList.add('hidden');
        actionMessage.textContent = "Game Over. Calculating score...";
    }
}

function handleCellClick(index) {
    if (!isGameActive || gridData[index] !== null) return;
    if (draftIndex !== index) {
        draftIndex = index;
        renderGrid();
        updateUI();
    } else {
        if (currentMove === 24 && jokerLetter === null) {
            actionMessage.textContent = "Please select a letter from the keyboard first!";
            return;
        }

        gridData[index] = currentMove === 24 ? jokerLetter : dailySequence[currentMove];
        currentMove++;
        draftIndex = null;
        
        saveGameState();

        if (currentMove === 25) {
            isGameActive = false;
            renderGrid();
            updateUI();
            calculateAndSaveScore();
        } else {
            renderGrid();
            updateUI();
        }
    }
}

// ==========================================
// 5. SCORING & WORD COLLECTION
// ==========================================
function getLineString(indices) {
    return indices.map(index => gridData[index] || ' ').join('');
}

function calculateLineData(text) {
    function findMaxScore(index) {
        if (index >= text.length) {
            return { score: 0, words: [] };
        }
        let bestResult = findMaxScore(index + 1);
        for (let len = 2; len <= 5; len++) {
            if (index + len <= text.length) {
                const sub = text.substring(index, index + len);
                if (dictionary.has(sub)) {
                    const nextResult = findMaxScore(index + len);
                    const currentTotalScore = SCORE_RULES[len] + nextResult.score;
                    if (currentTotalScore > bestResult.score) {
                        bestResult = {
                            score: currentTotalScore,
                            words: [sub, ...nextResult.words]
                        };
                    }
                }
            }
        }
        return bestResult;
    }
    return findMaxScore(0);
}

function getScoreColorClass(score) {
    if (score >= 15) return 'score-15';
    if (score >= 9) return 'score-9';
    if (score >= 7) return 'score-7';
    if (score >= 5) return 'score-5';
    if (score >= 4) return 'score-4';
    if (score >= 2) return 'score-2';
    return 'score-0';
}

function calculateAndSaveScore() {
    let totalScore = 0;
    let allFoundWords = [];
    const GRID_SIZE = 5;
    
    let rowScores = Array(5).fill(0);
    let colScores = Array(5).fill(0);

    for (let row = 0; row < GRID_SIZE; row++) {
        const indices = Array.from({ length: GRID_SIZE }, (_, i) => row * GRID_SIZE + i);
        const lineStr = getLineString(indices);
        const lineData = calculateLineData(lineStr);
        rowScores[row] = lineData.score;
        totalScore += lineData.score;
        allFoundWords.push(...lineData.words);
    }

    for (let col = 0; col < GRID_SIZE; col++) {
        const indices = Array.from({ length: GRID_SIZE }, (_, i) => i * GRID_SIZE + col);
        const lineStr = getLineString(indices);
        const lineData = calculateLineData(lineStr);
        colScores[col] = lineData.score;
        totalScore += lineData.score;
        allFoundWords.push(...lineData.words);
    }

    document.body.classList.remove('game-locked');

    renderFinalGrid(rowScores, colScores);
    
    const uniqueWords = [...new Set(allFoundWords)].sort((a, b) => b.length - a.length || a.localeCompare(b));
    renderWordsList(uniqueWords);

    const messageArea = document.getElementById('game-message-area');
    if (messageArea) messageArea.classList.add('hidden');

    const endStatsArea = document.getElementById('end-game-stats-area');
    if (endStatsArea) endStatsArea.classList.remove('hidden');

    const finalUserScoreVal = document.getElementById('final-user-score-value');
    if (finalUserScoreVal) finalUserScoreVal.textContent = totalScore;

    const shareBtn = document.getElementById('btn-share-score');
    if (shareBtn) {
        shareBtn.classList.remove('hidden');
        shareBtn.onclick = () => handleShare(totalScore, rowScores, colScores);
    }
    
    submitToFirebase(totalScore);
    updatePlayerStats(totalScore);
    
    const dateStr = getLocalDateStr(currentPlayingDate);
    handleDailyTopScore(totalScore, dateStr);
}

function renderFinalGrid(rowScores, colScores) {
    gridEl.classList.add('final-grid');
    gridEl.innerHTML = '';
    
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = gridData[i];
        cell.setAttribute('data-state', 'filled');
        gridEl.appendChild(cell);
        
        if ((i + 1) % 5 === 0) {
            const rowIndex = Math.floor(i / 5);
            const score = rowScores[rowIndex];
            const scoreCell = document.createElement('div');
            scoreCell.className = `cell score-cell ${getScoreColorClass(score)}`;
            scoreCell.textContent = score;
            gridEl.appendChild(scoreCell);
        }
    }
    
    colScores.forEach(score => {
        const scoreCell = document.createElement('div');
        scoreCell.className = `cell score-cell ${getScoreColorClass(score)}`;
        scoreCell.textContent = score;
        gridEl.appendChild(scoreCell);
    });
    
    const cornerCell = document.createElement('div');
    cornerCell.className = 'cell empty-corner';
    gridEl.appendChild(cornerCell);
}

async function submitToFirebase(score) {
    if (!userId) return;
    const dateStr = getLocalDateStr(currentPlayingDate);
    try {
        // EN_ISOLATION: scores tablosu ayrıldı
        const docRef = doc(db, COLLECTIONS.SCORES, `${dateStr}_${userId}`);
        await setDoc(docRef, {
            userId: userId,
            score: score,
            grid: gridData,
            date: dateStr,
            timestamp: new Date()
        }, { merge: true });
        
        // Kullanıcı bazlı arşiv sistemi için de ayrım sağladık
        const userArchiveRef = doc(db, "users", userId, "daily_scores_EN", dateStr);
        await setDoc(userArchiveRef, {
            score: score,
            date: dateStr,
            timestamp: new Date()
        }, { merge: true });
    } catch (e) {
        console.error("Error saving score: ", e);
    }
}

// ==========================================
// 6. STATISTICS & DAILY BEST LOGIC
// ==========================================
async function updatePlayerStats(newScore) {
    let stats = JSON.parse(localStorage.getItem(STORAGE_KEYS.STATS)) || {
        played: 0,
        streak: 0,
        maxStreak: 0,
        distribution: {},
        bestScore: 0,
        lastDate: null
    };

    const dateStr = getLocalDateStr(currentPlayingDate);
    
    if (stats.lastDate !== dateStr) {
        stats.played += 1;
        
        const yesterday = new Date(currentPlayingDate);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = getLocalDateStr(yesterday);
        
        if (stats.lastDate === yesterdayStr) {
            stats.streak += 1;
        } else {
            stats.streak = 1;
        }
        
        if (stats.streak > stats.maxStreak) {
            stats.maxStreak = stats.streak;
        }
        
        stats.lastDate = dateStr;
    }

    if (newScore > stats.bestScore) {
        stats.bestScore = newScore;
        const userScoreBox = document.querySelector('.user-score-box');
        if (userScoreBox) userScoreBox.classList.add('new-record');
    }

    const range = Math.floor(newScore / 20) * 20;
    const rangeStr = `${range}-${range + 19}`;
    stats.distribution[rangeStr] = (stats.distribution[rangeStr] || 0) + 1;

    localStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(stats));

    if (userId) {
        await setDoc(doc(db, COLLECTIONS.PLAYER_STATS, userId), stats);
    }
}

async function handleDailyTopScore(userScore, dateStr) {
    const dailyBestVal = document.getElementById('final-daily-best-value');
    if (!dailyBestVal) return;
    
    try {
        const q = query(
            collection(db, COLLECTIONS.SCORES),
            where("date", "==", dateStr),
            orderBy("score", "desc"),
            limit(1)
        );
        const querySnapshot = await getDocs(q);
        
        let highestGlobalScore = userScore;
        if (!querySnapshot.empty) {
            const topDoc = querySnapshot.docs[0].data();
            highestGlobalScore = Math.max(userScore, topDoc.score);
        }
        
        dailyBestVal.textContent = highestGlobalScore;

        if (userScore >= highestGlobalScore && userScore > 0) {
            const dailyBestBox = document.querySelector('.daily-best-box');
            if(dailyBestBox) dailyBestBox.classList.add('new-record');
        }

    } catch (error) {
        console.error("Error handling top score:", error);
    }
}

// ==========================================
// 7. DICTIONARY API & MODAL LOGIC
// ==========================================
function renderWordsList(words) {
    wordsListContainer.innerHTML = '';
    wordsListContainer.classList.remove('hidden');
    
    if (words.length === 0) {
        wordsListContainer.innerHTML = '<span style="color: var(--color-text-muted); font-size: 14px;">No words found.</span>';
        return;
    }

    words.forEach(word => {
        const btn = document.createElement('button');
        btn.className = 'word-pill';
        btn.textContent = word;
        btn.addEventListener('click', () => openDictionaryModal(word));
        wordsListContainer.appendChild(btn);
    });
}

async function openDictionaryModal(word) {
    modalTitle.textContent = word;
    modalDef.innerHTML = '<p class="def-text">Looking up definition...</p>';
    dictModal.classList.add('active');

    try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        if (!response.ok) {
            modalDef.innerHTML = '<p class="def-text">Valid game word, but specific definition not found in this free dictionary.</p>';
            return;
        }

        const data = await response.json();
        const meanings = data[0].meanings;
        let htmlContent = '';
        
        meanings.slice(0, 2).forEach(meaning => {
            htmlContent += `<div class="def-part">${meaning.partOfSpeech}</div>`;
            htmlContent += `<div class="def-text">• ${meaning.definitions[0].definition}</div>`;
        });
        
        modalDef.innerHTML = htmlContent;
    } catch (error) {
        modalDef.innerHTML = '<p class="def-text">Connection error. Could not fetch definition.</p>';
    }
}

if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => dictModal.classList.remove('active'));
}

// ==========================================
// 8. ARCHIVE SYSTEM (EN ISOLATION)
// ==========================================
const btnArchive = document.getElementById('btn-archive');
const archiveModal = document.getElementById('archive-modal');
const closeArchiveBtn = document.getElementById('close-archive');
const archiveList = document.getElementById('archive-list');

if (btnArchive) {
    btnArchive.addEventListener('click', async () => {
        archiveModal.classList.add('active');
        await loadArchiveData();
    });
}

if (closeArchiveBtn) {
    closeArchiveBtn.addEventListener('click', () => archiveModal.classList.remove('active'));
}

async function loadArchiveData() {
    if (!userId) {
        archiveList.innerHTML = '<p class="def-text" style="text-align: center;">Unable to load user data.</p>';
        return;
    }

    archiveList.innerHTML = '<p class="def-text" style="text-align: center;">Fetching records...</p>';
    try {
        // EN_ISOLATION
        const scoresRef = collection(db, "users", userId, "daily_scores_EN");
        const querySnapshot = await getDocs(scoresRef);
        
        const userScores = {};
        querySnapshot.forEach((doc) => {
            userScores[doc.id] = doc.data().score;
        });
        
        renderArchiveUI(userScores);
    } catch (error) {
        console.error("Archive fetch error:", error);
        archiveList.innerHTML = '<p class="def-text" style="text-align: center;">Error loading archive.</p>';
    }
}

function renderArchiveUI(userScores) {
    archiveList.innerHTML = '';
    const startDate = new Date("2026-03-06T00:00:00");
    const today = new Date();
    let currentDate = new Date(today);
    
    while (currentDate >= startDate) {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        const displayDate = currentDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const itemDiv = document.createElement('div');
        
        if (userScores[dateStr] !== undefined) {
            itemDiv.className = 'archive-item played';
            itemDiv.innerHTML = `
                <span class="archive-date">${displayDate}</span>
                <span class="archive-status archive-score">Score: ${userScores[dateStr]}</span>
            `;
        } else {
            itemDiv.className = 'archive-item';
            itemDiv.innerHTML = `
                <span class="archive-date">${displayDate}</span>
                <button class="archive-play-btn" data-date="${dateStr}">Play</button>
            `;
        }
        
        archiveList.appendChild(itemDiv);
        currentDate.setDate(currentDate.getDate() - 1);
    }
}

if (archiveList) {
    archiveList.addEventListener('click', (e) => {
        if (e.target.classList.contains('archive-play-btn')) {
            const dateStr = e.target.getAttribute('data-date');
            archiveModal.classList.remove('active'); 
            startSpecificDateGame(dateStr); 
        }
    });
}

function startSpecificDateGame(dateStr) {
    const parts = dateStr.split('-');
    currentPlayingDate = new Date(parts[0], parts[1] - 1, parts[2]);
    
    gridData = Array(25).fill(null);
    currentMove = 0;
    isGameActive = true;
    draftIndex = null;
    jokerLetter = null;
    
    localStorage.removeItem(STORAGE_KEYS.STATE);
    
    setupDailyContext();
    
    // UI RESET
    gridEl.classList.remove('final-grid');
    const wordsContainer = document.getElementById('words-list-container');
    if(wordsContainer) wordsContainer.classList.add('hidden');
    
    const endStatsArea = document.getElementById('end-game-stats-area');
    if(endStatsArea) endStatsArea.classList.add('hidden');
    
    const userScoreBox = document.querySelector('.user-score-box');
    if(userScoreBox) userScoreBox.classList.remove('new-record');
    const dailyBestBox = document.querySelector('.daily-best-box');
    if(dailyBestBox) dailyBestBox.classList.remove('new-record');

    const shareBtn = document.getElementById('btn-share-score');
    if(shareBtn) shareBtn.classList.add('hidden');
    
    const messageArea = document.getElementById('game-message-area');
    if(messageArea) messageArea.classList.remove('hidden');

    document.body.classList.add('game-locked');
    renderGrid();
    updateUI();
    saveGameState();
    
    const actionMessage = document.getElementById('action-message');
    if(actionMessage) actionMessage.textContent = "Archive loaded. Tap a cell to draft.";
}

// ==========================================
// 9. SHARE & EMOJI LOGIC
// ==========================================
function getScoreHeartEmoji(score) {
    if (score >= 15) return '💜';
    if (score >= 9) return '💙';
    if (score >= 7) return '🩵';
    if (score >= 5) return '💚';
    if (score >= 4) return '💛';
    if (score >= 2) return '🧡';
    return '🩶';
}

async function handleShare(totalScore, rowScores, colScores) {
    const challengeNo = document.getElementById('challenge-display').textContent;
    const shareLink = window.location.href;
    const emptyCell = '⬜'; 
    
    let gridText = "";
    for (let i = 0; i < 5; i++) {
        gridText += `${emptyCell}${emptyCell}${emptyCell}${emptyCell}${emptyCell} ${getScoreHeartEmoji(rowScores[i])}\n`;
    }
    
    gridText += "\n";
    for (let i = 0; i < 5; i++) {
        gridText += getScoreHeartEmoji(colScores[i]);
    }

    const shareText = `Grid Master ${challengeNo}\nScore: ${totalScore}\n\n${gridText}\n\n${shareLink}`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Grid Master Score',
                text: shareText
            });
        } catch (err) {
            console.log("Share cancelled or failed.", err);
        }
    } else {
        navigator.clipboard.writeText(shareText).then(() => {
            alert("Score copied to clipboard!");
        });
    }
}

// ==========================================
// 10. HELP & STATS MODAL EVENTS
// ==========================================
const btnHelp = document.getElementById('btn-help');
const helpModal = document.getElementById('help-modal');
const closeHelpBtn = document.getElementById('close-help');

if (btnHelp) {
    btnHelp.addEventListener('click', () => {
        helpModal.classList.add('active');
    });
}

if (closeHelpBtn) {
    closeHelpBtn.addEventListener('click', () => {
        helpModal.classList.remove('active');
    });
}

const btnStats = document.getElementById('btn-stats');
const statsModal = document.getElementById('stats-modal');
const closeStatsBtn = document.getElementById('close-stats');

if (btnStats) {
    btnStats.addEventListener('click', () => {
        statsModal.classList.add('active');
        renderStatsUI();
    });
}

if (closeStatsBtn) {
    closeStatsBtn.addEventListener('click', () => {
        statsModal.classList.remove('active');
    });
}

function renderStatsUI() {
    const stats = JSON.parse(localStorage.getItem(STORAGE_KEYS.STATS)) || {
        played: 0, streak: 0, maxStreak: 0, bestScore: 0, distribution: {}
    };

    document.getElementById('stat-played').textContent = stats.played;
    document.getElementById('stat-streak').textContent = stats.streak;
    document.getElementById('stat-max-streak').textContent = stats.maxStreak;
    document.getElementById('personal-best-value').textContent = stats.bestScore;

    const distContainer = document.getElementById('dist-container');
    if (Object.keys(stats.distribution).length === 0) {
        distContainer.innerHTML = '<p class="def-text">Play a game to see your distribution!</p>';
        return;
    }

    distContainer.innerHTML = '';
    const ranges = ['0-19', '20-39', '40-59', '60-79', '80-99', '100-119', '120-139', '140-159', '160+'];
    const maxCount = Math.max(...Object.values(stats.distribution), 1);

    ranges.forEach(range => {
        const count = stats.distribution[range] || 0;
        const widthPercent = Math.max((count / maxCount) * 100, 5); 
        
        const wrapper = document.createElement('div');
        wrapper.className = 'dist-bar-wrapper';
        
        const label = document.createElement('span');
        label.style.width = '50px';
        label.textContent = range;

        const bar = document.createElement('div');
        bar.className = 'dist-bar';
        if (count > 0 && new Date().toDateString() === new Date(stats.lastDate || '').toDateString()) {
             bar.classList.add('highlight');
        }
        bar.style.width = `${widthPercent}%`;
        bar.textContent = count;

        wrapper.appendChild(label);
        wrapper.appendChild(bar);
        distContainer.appendChild(wrapper);
    });
}

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

// ==========================================
// 11. DARK MODE LOGIC
// ==========================================
const btnTheme = document.getElementById('btn-theme');
const iconMoon = document.getElementById('theme-icon-moon');
const iconSun = document.getElementById('theme-icon-sun');

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
    
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        if (iconMoon && iconSun) {
            iconMoon.classList.add('hidden');
            iconSun.classList.remove('hidden');
        }
    }
});

if (btnTheme) {
    btnTheme.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        
        if (isDark) {
            localStorage.setItem(STORAGE_KEYS.THEME, 'dark');
            iconMoon.classList.add('hidden');
            iconSun.classList.remove('hidden');
        } else {
            localStorage.setItem(STORAGE_KEYS.THEME, 'light');
            iconSun.classList.add('hidden');
            iconMoon.classList.remove('hidden');
        }
    });
}

// ==========================================
// 12. DEVELOPMENT TOOLS & INIT
// ==========================================
const btnDevReset = document.getElementById('btn-dev-reset');
if (btnDevReset) {
    btnDevReset.addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEYS.STATE);
        window.location.reload();
    });
}

// Start Engine
document.addEventListener('DOMContentLoaded', initGame);
