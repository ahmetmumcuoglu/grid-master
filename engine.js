import { firebaseConfig } from './config.js';

// ==========================================
// 1. GAME STATE & CONSTANTS
// ==========================================
let dictionary = new Set();
let gridData = Array(25).fill(null);
let dailySequence = [];
let currentMove = 0; // Tracks turns 0 to 24
let isGameActive = false;
let draftIndex = null; // NEW: Tracks the temporary placement

// English Letter Distribution (Weighted Pool)
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
const btnSubmit = document.getElementById('btn-submit'); // NEW

// ==========================================
// 2. INITIALIZATION
// ==========================================
async function initGame() {
    try {
        actionMessage.textContent = "Loading dictionary...";
        
        const response = await fetch('words.json');
        if (!response.ok) throw new Error("Failed to load dictionary");
        const wordsArray = await response.json();
        dictionary = new Set(wordsArray.map(w => w.toUpperCase()));
        
        setupDailyContext();
        
        renderGrid();
        updateUI();
        
        isGameActive = true;
        actionMessage.textContent = "Select a cell to draft your letter.";
        
        // Event Listeners
        btnSubmit.addEventListener('click', submitMove);
        
    } catch (error) {
        console.error("Initialization Error:", error);
        actionMessage.textContent = "Error loading game data.";
    }
}

// ==========================================
// 3. DAILY SEEDED RNG & 10/14 LOGIC
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

// NEW: Strict 10 Vowels, 14 Consonants Logic
function generateDailyLetters(seed) {
    const random = mulberry32(seed);
    let vowelPool = [];
    let consonantPool = [];
    
    // Separate pools based on weights
    for (let [letter, count] of Object.entries(LETTER_POOL)) {
        for (let i = 0; i < count; i++) {
            if (VOWELS.includes(letter)) vowelPool.push(letter);
            else consonantPool.push(letter);
        }
    }
    
    // Helper function to shuffle an array
    const shuffle = (array) => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    };
    
    shuffle(vowelPool);
    shuffle(consonantPool);
    
    // Extract exactly 10 Vowels and 14 Consonants
    let finalSequence = [];
    finalSequence.push(...vowelPool.slice(0, 10));
    finalSequence.push(...consonantPool.slice(0, 14));
    
    // Shuffle the combined 24 letters
    shuffle(finalSequence);
    
    return finalSequence;
}

// ==========================================
// 4. UI RENDERING & DRAFT MECHANIC
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
            // NEW: Render Draft State
            cell.textContent = dailySequence[currentMove];
            cell.setAttribute('data-state', 'draft');
            cell.addEventListener('click', () => handleCellClick(i));
        } else {
            cell.setAttribute('data-state', 'empty');
            cell.addEventListener('click', () => handleCellClick(i));
        }
        
        gridEl.appendChild(cell);
    }
}

function updateUI() {
    if (currentMove < 24) {
        currentLetterBox.textContent = dailySequence[currentMove];
        currentLetterBox.classList.remove('hidden');
        
        // DÜZELTİLDİ: hidden yerine v-hidden kullanıyoruz
        if (draftIndex !== null) {
            btnSubmit.classList.remove('v-hidden');
            actionMessage.textContent = "Press PLACE to confirm.";
        } else {
            btnSubmit.classList.add('v-hidden');
            actionMessage.textContent = "Select a cell to draft your letter.";
        }
        
    } else if (currentMove === 24) {
        currentLetterBox.textContent = "?";
        btnSubmit.classList.add('v-hidden');
        actionMessage.textContent = "Select any letter for your final move!";
    } else {
        currentLetterBox.classList.add('hidden');
        btnSubmit.classList.add('v-hidden');
        actionMessage.textContent = "Game Over. Calculating score...";
    }
}

function handleCellClick(index) {
    if (!isGameActive || gridData[index] !== null) return;
    
    if (currentMove < 24) {
        // Just move the draft index, don't lock it
        if (draftIndex === index) {
            draftIndex = null; // Toggle off if clicked again
        } else {
            draftIndex = index;
        }
        renderGrid();
        updateUI();
    } else if (currentMove === 24) {
        alert("Joker selection UI will open here!");
    }
}

function submitMove() {
    if (draftIndex === null || gridData[draftIndex] !== null) return;
    
    // Lock the letter in
    gridData[draftIndex] = dailySequence[currentMove];
    currentMove++;
    draftIndex = null; // Reset draft
    
    renderGrid();
    updateUI();
}

// Start Engine
document.addEventListener('DOMContentLoaded', initGame);
