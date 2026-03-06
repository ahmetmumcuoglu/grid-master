import { firebaseConfig } from './config.js';

// ==========================================
// 1. GAME STATE & CONSTANTS
// ==========================================
let dictionary = new Set();
let gridData = Array(25).fill(null);
let dailySequence = [];
let currentMove = 0;
let isGameActive = false;
let draftIndex = null;
let jokerLetter = null; // YENİ: Joker harfini tutar

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
const btnSubmit = document.getElementById('btn-submit');
const jokerKeyboard = document.getElementById('joker-keyboard'); // YENİ

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
        btnSubmit.addEventListener('click', submitMove);
        
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
            // YENİ: Normal turda sıradaki harf, 25. turda joker harfi gösterilir
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

// YENİ: Joker klavyesini çizen ve tuşları ayarlayan fonksiyon
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
            // Son kalan boş hücreyi bul ve otomatik olarak orayı hedef al
            draftIndex = gridData.indexOf(null);
            renderKeyboard();
            renderGrid();
            updateUI();
        });
        
        jokerKeyboard.appendChild(btn);
    });
}

function updateUI() {
    if (currentMove < 24) {
        // Normal turlar
        currentLetterBox.textContent = dailySequence[currentMove];
        currentLetterBox.classList.remove('hidden');
        jokerKeyboard.classList.add('hidden');
        
        if (draftIndex !== null) {
            btnSubmit.classList.remove('v-hidden');
            actionMessage.textContent = "Press PLACE to confirm.";
        } else {
            btnSubmit.classList.add('v-hidden');
            actionMessage.textContent = "Select a cell to draft your letter.";
        }
        
    } else if (currentMove === 24) {
        // YENİ: Joker turu (25. Tur)
        currentLetterBox.classList.add('hidden');
        jokerKeyboard.classList.remove('hidden');
        renderKeyboard();
        
        if (draftIndex !== null && jokerLetter !== null) {
            btnSubmit.classList.remove('v-hidden');
            actionMessage.textContent = "Press PLACE to finish the game.";
        } else {
            btnSubmit.classList.add('v-hidden');
            actionMessage.textContent = "Choose your final letter.";
        }
        
    } else {
        // Game Over
        currentLetterBox.classList.add('hidden');
        jokerKeyboard.classList.add('hidden');
        btnSubmit.classList.add('v-hidden');
        actionMessage.textContent = "Game Over. Calculating score...";
    }
}

function handleCellClick(index) {
    if (!isGameActive || gridData[index] !== null) return;
    
    if (currentMove < 24) {
        if (draftIndex === index) {
            draftIndex = null;
        } else {
            draftIndex = index;
        }
        renderGrid();
        updateUI();
    }
    // 25. turda hücreye tıklamaya gerek yok, klavyeden seçince otomatik yerleşiyor
}

function submitMove() {
    if (draftIndex === null || gridData[draftIndex] !== null) return;
    
    // YENİ: Eğer 25. turdaysak joker harfini, değilse normal dizilimdeki harfi kaydet
    gridData[draftIndex] = currentMove === 24 ? jokerLetter : dailySequence[currentMove];
    currentMove++;
    draftIndex = null;
    
    if (currentMove === 25) {
        isGameActive = false; // Oyun bitti
    }
    
    renderGrid();
    updateUI();
}

// Start Engine
document.addEventListener('DOMContentLoaded', initGame);
