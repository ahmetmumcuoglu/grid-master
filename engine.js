import { firebaseConfig } from './config.js';

// ==========================================
// 1. GAME STATE & CONSTANTS
// ==========================================
let dictionary = new Set();
let gridData = Array(25).fill(null);
let dailySequence = [];
let currentMove = 0; // Tracks turns 0 to 24
let isGameActive = false;

// English Letter Distribution (Classic Word Game Style)
const LETTER_POOL = {
    'A': 9, 'B': 2, 'C': 2, 'D': 4, 'E': 12, 'F': 2, 'G': 3, 'H': 2,
    'I': 9, 'J': 1, 'K': 1, 'L': 4, 'M': 2, 'N': 6, 'O': 8, 'P': 2,
    'Q': 1, 'R': 6, 'S': 4, 'T': 6, 'U': 4, 'V': 2, 'W': 2, 'X': 1,
    'Y': 2, 'Z': 1
};
const VOWELS = ['A', 'E', 'I', 'O', 'U'];

// DOM Elements
const gridEl = document.getElementById('grid');
const currentLetterBox = document.getElementById('current-letter-box');
const actionMessage = document.getElementById('action-message');
const dateDisplay = document.getElementById('date-display');
const challengeDisplay = document.getElementById('challenge-display');

// ==========================================
// 2. INITIALIZATION
// ==========================================
async function initGame() {
    try {
        actionMessage.textContent = "Loading dictionary...";
        
        // 1. Load English Dictionary
        const response = await fetch('words.json');
        if (!response.ok) throw new Error("Failed to load dictionary");
        const wordsArray = await response.json();
        dictionary = new Set(wordsArray.map(w => w.toUpperCase()));
        
        // 2. Setup Daily Challenge
        setupDailyContext();
        
        // 3. Render Initial UI
        renderGrid();
        updateUI();
        
        isGameActive = true;
        actionMessage.textContent = "Place your letter";
        
    } catch (error) {
        console.error("Initialization Error:", error);
        actionMessage.textContent = "Error loading game data.";
    }
}

// ==========================================
// 3. DAILY SEEDED RNG LOGIC
// ==========================================
function setupDailyContext() {
    const today = new Date();
    
    // Format Date for Header (e.g., "March 6, 2026")
    const options = { month: 'long', day: 'numeric', year: 'numeric' };
    dateDisplay.textContent = today.toLocaleDateString('en-US', options);
    
    // Calculate Challenge Number (Assuming Day 1 is March 6, 2026)
    const startDate = new Date("2026-03-06");
    const diffTime = Math.abs(today - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    challengeDisplay.textContent = `No. ${diffDays}`;
    
    // Generate Seed: YYYYMMDD
    const seed = (today.getFullYear() * 10000) + ((today.getMonth() + 1) * 100) + today.getDate();
    dailySequence = generateDailyLetters(seed);
}

// Seeded random number generator
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
    let pool = [];
    
    // Populate the pool based on weights
    for (let [letter, count] of Object.entries(LETTER_POOL)) {
        for (let i = 0; i < count; i++) {
            pool.push(letter);
        }
    }
    
    // Shuffle pool using seeded random
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    
    // Take exactly 24 letters (25th is Joker)
    return pool.slice(0, 24);
}

// ==========================================
// 4. UI RENDERING & INTERACTION
// ==========================================
function renderGrid() {
    gridEl.innerHTML = '';
    
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        
        if (gridData[i]) {
            cell.textContent = gridData[i];
            cell.setAttribute('data-state', 'filled');
        } else {
            cell.setAttribute('data-state', 'empty');
            // Only add click listener if game is active and cell is empty
            cell.addEventListener('click', () => handleCellClick(i));
        }
        
        gridEl.appendChild(cell);
    }
}

function updateUI() {
    if (currentMove < 24) {
        currentLetterBox.textContent = dailySequence[currentMove];
        currentLetterBox.classList.remove('hidden');
    } else if (currentMove === 24) {
        // Turn 25: Joker Time
        currentLetterBox.textContent = "?";
        actionMessage.textContent = "Select any letter for your final move!";
    } else {
        // Game Over
        currentLetterBox.classList.add('hidden');
        actionMessage.textContent = "Game Over. Calculating score...";
    }
}

function handleCellClick(index) {
    if (!isGameActive || gridData[index] !== null) return;
    
    if (currentMove < 24) {
        // Standard Move
        gridData[index] = dailySequence[currentMove];
        currentMove++;
        renderGrid();
        updateUI();
    } else if (currentMove === 24) {
        // TODO: Implement Joker Keyboard Modal selection here
        alert("Joker selection UI will open here!");
    }
}

// Start Engine
document.addEventListener('DOMContentLoaded', initGame);
