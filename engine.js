import { firebaseConfig } from './config.js';
// Make sure to import Firestore components if using Firebase v9+ modular SDK
// import { getFirestore, doc, setDoc } from "firebase/firestore"; 

// ==========================================
// 1. GAME STATE & CONSTANTS
// ==========================================
let dictionary = new Set();
let gridData = Array(25).fill(null);
let dailySequence = [];
let currentMove = 0;
let isGameActive = false;
let draftIndex = null;
let jokerLetter = null;

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
        loadGameState(); // YENİ: Kayıtlı oyunu kontrol et
        
        renderGrid();
        updateUI();
        
        if (currentMove < 25) {
            isGameActive = true;
            actionMessage.textContent = "Tap a cell to draft, tap again to place.";
        } else {
            // Eğer sayfa yenilendiğinde oyun zaten bitmişse direkt sonuçları göster
            calculateAndSaveScore();
        }
        
    } catch (error) {
        console.error("Initialization Error:", error);
        actionMessage.textContent = "Error loading game data.";
    }
}

// YENİ: Oyunu tarayıcı hafızasından yükler
function loadGameState() {
    const savedState = localStorage.getItem('gridMaster_dailyState');
    const todayStr = new Date().toDateString();

    if (savedState) {
        const state = JSON.parse(savedState);
        // Eğer kayıt bugüne aitse yükle, dünün kaydıysa sil
        if (state.date === todayStr) {
            gridData = state.grid;
            currentMove = state.move;
        } else {
            localStorage.removeItem('gridMaster_dailyState');
        }
    }
}

// YENİ: Hamle yapıldıkça oyunu tarayıcı hafızasına kaydeder
function saveGameState() {
    const state = {
        date: new Date().toDateString(),
        grid: gridData,
        move: currentMove
    };
    localStorage.setItem('gridMaster_dailyState', JSON.stringify(state));
}

// ==========================================
// 3. DAILY SEEDED RNG LOGIC
// ==========================================
function setupDailyContext() {
    const today = new Date();
    const options = { month: 'long', day: 'numeric', year: 'numeric' };
    dateDisplay.textContent = today.toLocaleDateString('en-US', options);
    
    const startDate = new Date("2026-03-06");
    const diffTime = Math.abs(today - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    challengeDisplay.textContent = `No. ${diffDays}`;
    
    const seed = (today.getFullYear() * 10000) + ((today.getMonth() + 1) * 100) + today.getDate();
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
    } 
    else {
        if (currentMove === 24 && jokerLetter === null) {
            actionMessage.textContent = "Please select a letter from the keyboard first!";
            return;
        }

        gridData[index] = currentMove === 24 ? jokerLetter : dailySequence[currentMove];
        currentMove++;
        draftIndex = null;
        
        saveGameState(); // YENİ: Hamleyi Local Storage'a kaydet

        if (currentMove === 25) {
            isGameActive = false;
            renderGrid();
            updateUI();
            calculateAndSaveScore(); // YENİ: Oyun bitti, puanı hesapla
        } else {
            renderGrid();
            updateUI();
        }
    }
}

// ==========================================
// 5. SCORING & FINAL GRID RENDERING
// ==========================================

function getLineString(indices) {
    return indices.map(index => gridData[index] || ' ').join('');
}

function getSegmentScore(text) {
    let bestScore = 0;
    
    // Check all possible sub-strings (length 2 to 5)
    for (let len = 5; len >= 2; len--) {
        for (let i = 0; i <= text.length - len; i++) {
            const sub = text.substring(i, i + len);
            if (dictionary.has(sub)) {
                if (SCORE_RULES[len] > bestScore) {
                    bestScore = SCORE_RULES[len];
                }
            }
        }
    }
    return bestScore;
}

function calculateAndSaveScore() {
    let totalScore = 0;
    const GRID_SIZE = 5;
    
    // Arrays to hold scores for each row and column
    let rowScores = Array(5).fill(0);
    let colScores = Array(5).fill(0);

    // Check Rows
    for (let row = 0; row < GRID_SIZE; row++) {
        const indices = Array.from({ length: GRID_SIZE }, (_, i) => row * GRID_SIZE + i);
        const lineStr = getLineString(indices);
        const segments = lineStr.split(' ');
        segments.forEach(seg => {
            if (seg.length >= 2) {
                const score = getSegmentScore(seg);
                rowScores[row] += score;
                totalScore += score;
            }
        });
    }

    // Check Columns
    for (let col = 0; col < GRID_SIZE; col++) {
        const indices = Array.from({ length: GRID_SIZE }, (_, i) => i * GRID_SIZE + col);
        const lineStr = getLineString(indices);
        const segments = lineStr.split(' ');
        segments.forEach(seg => {
            if (seg.length >= 2) {
                const score = getSegmentScore(seg);
                colScores[col] += score;
                totalScore += score;
            }
        });
    }

    actionMessage.textContent = `Excellent! Your Score: ${totalScore}`;
    
    // Transform 5x5 to 6x6 Score Grid
    renderFinalGrid(rowScores, colScores);
    
    // TODO: Prepare data for Firebase submission
    submitToFirebase(totalScore);
}

// NEW: Renders the 6x6 Grid with row and column scores
function renderFinalGrid(rowScores, colScores) {
    gridEl.classList.add('final-grid');
    gridEl.innerHTML = '';
    
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = gridData[i];
        cell.setAttribute('data-state', 'filled');
        gridEl.appendChild(cell);
        
        // At the end of every row (indices 4, 9, 14, 19, 24), append the row score
        if ((i + 1) % 5 === 0) {
            const rowIndex = Math.floor(i / 5);
            const scoreCell = document.createElement('div');
            scoreCell.className = 'cell score-cell';
            scoreCell.textContent = rowScores[rowIndex];
            gridEl.appendChild(scoreCell);
        }
    }
    
    // After 25 cells and 5 row scores, append the 5 column scores for the bottom row
    colScores.forEach(score => {
        const scoreCell = document.createElement('div');
        scoreCell.className = 'cell score-cell';
        scoreCell.textContent = score;
        gridEl.appendChild(scoreCell);
    });
    
    // Append the final empty corner cell
    const cornerCell = document.createElement('div');
    cornerCell.className = 'cell empty-corner';
    gridEl.appendChild(cornerCell);
}

function submitToFirebase(score) {
    console.log("Game Over. Total Score:", score);
    // Firebase implementation will go here
}

// ==========================================
// 6. DEVELOPMENT TOOLS
// ==========================================

// NEW: Dev Reset mechanism to quickly test the game repeatedly
const btnDevReset = document.getElementById('btn-dev-reset');
if (btnDevReset) {
    btnDevReset.addEventListener('click', () => {
        // Clear the saved state from LocalStorage
        localStorage.removeItem('gridMaster_dailyState');
        // Reload the page to start a fresh game
        window.location.reload();
    });
}

// Start Engine
document.addEventListener('DOMContentLoaded', initGame);
