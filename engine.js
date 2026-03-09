import { firebaseConfig } from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ==========================================
// 0. FIREBASE INITIALIZATION & AUTH
// ==========================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let userId = null; // Oyuncunun gizli kimliği

// Oyuncu siteye girer girmez sessizce giriş yap
signInAnonymously(auth)
    .catch((error) => {
        console.error("Firebase Auth Error:", error.code, error.message);
    });

// Giriş durumunu dinle ve ID'yi kaydet
onAuthStateChanged(auth, (user) => {
    if (user) {
        userId = user.uid;
        console.log("Oyuncu kimliği oluşturuldu/bulundu:", userId);
    }
});

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
// 5. SCORING & WORD COLLECTION
// ==========================================

function getLineString(indices) {
    return indices.map(index => gridData[index] || ' ').join('');
}

// YENİ: Artık sadece skoru değil, bulunan kelimeleri de dizi olarak döndürüyor
function calculateLineData(text) {
    let lineTotal = 0;
    let foundWords = [];
    let i = 0;

    while (i < text.length) {
        let foundWordLength = 0;
        let foundScore = 0;
        let foundWordStr = "";

        for (let len = 5; len >= 2; len--) {
            if (i + len <= text.length) {
                const sub = text.substring(i, i + len);
                if (dictionary.has(sub)) {
                    foundWordLength = len;
                    foundScore = SCORE_RULES[len];
                    foundWordStr = sub;
                    break; 
                }
            }
        }

        if (foundWordLength > 0) {
            lineTotal += foundScore;
            foundWords.push(foundWordStr); // Kelimeyi hafızaya al
            i += foundWordLength; 
        } else {
            i++; 
        }
    }
    return { score: lineTotal, words: foundWords };
}

// ... (getScoreColorClass fonksiyonu aynı kalıyor) ...

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
    let allFoundWords = []; // Bütün bulunan kelimeler burada toplanacak
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

    actionMessage.textContent = `Your Score: ${totalScore}`;
    actionMessage.classList.add('final-score-text');
    
    renderFinalGrid(rowScores, colScores);
    
    // YENİ: Kelimeleri temizle, sırala ve ekrana bas
    const uniqueWords = [...new Set(allFoundWords)].sort((a, b) => b.length - a.length || a.localeCompare(b));
    renderWordsList(uniqueWords);
    
    submitToFirebase(totalScore);
}

// ... (renderFinalGrid fonksiyonu aynı kalıyor) ...

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

function submitToFirebase(score) {
    console.log("Firebase Upload Ready. Score:", score);
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

// ==========================================
// 7. DICTIONARY API & MODAL LOGIC
// ==========================================

function renderWordsList(words) {
    wordsListContainer.innerHTML = ''; // Temizle
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
    // Modalı aç ve yükleniyor göster
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
        
        // İlk 2 anlamı ekrana bas (uzunluk çok artmasın diye)
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

// Modalı kapatma işlemleri
if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => dictModal.classList.remove('active'));
}

// Modal dışına tıklanırsa da kapat
if (dictModal) {
    dictModal.addEventListener('click', (e) => {
        if (e.target === dictModal) {
            dictModal.classList.remove('active');
        }
    });
}
