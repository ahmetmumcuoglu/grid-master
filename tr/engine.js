import { firebaseConfig } from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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
let currentPlayingDate = new Date();
let cachedUserStats = null;

const LETTER_POOL = {
    'A': 5, 'E': 5, 'İ': 5, 'K': 6, 'L': 5, 'R': 6, 'N': 4, 'T': 4,
    'I': 3, 'M': 4, 'U': 4, 'Y': 3, 'S': 4, 'D': 3, 'O': 3, 'B': 3,
    'Ü': 3, 'Ş': 3, 'Z': 3, 'G': 1, 'H': 3, 'Ç': 3, 'P': 3, 'C': 2,
    'V': 2, 'Ö': 2, 'F': 2, 'J': 1, 'Ğ': 1
};
const VOWELS = ['A', 'E', 'I', 'İ', 'O', 'Ö', 'U', 'Ü'];
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
        loadGameState(); // Kayıtlı oyunu kontrol et
        
        renderGrid();
        updateUI();
        
        // Oyun durumu ve Ekran Kilidi Kontrolü
        if (currentMove < 25) {
            isGameActive = true;
            document.body.classList.add('game-locked'); // Oyun devam ediyorsa ekranı kilitle
            actionMessage.textContent = "Çift tıklayarak harfi hücreye yerleştirin.";
        } else {
            // Eğer sayfa yenilendiğinde oyun zaten bitmişse kilidi aç ve sonuçları göster
            document.body.classList.remove('game-locked'); 
            calculateAndSaveScore();
        }
        
    } catch (error) {
        console.error("Initialization Error:", error);
        actionMessage.textContent = "Error loading game data.";
    }
}

// YENİ: Tarihleri YYYY-MM-DD formatında standartlaştırmak için yardımcı fonksiyon
function getLocalDateStr(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 144 saatten eski, tamamlanmamış oyunları temizle
function cleanupOldGameStates() {
    const EXPIRY_MS = 144 * 60 * 60 * 1000; // 144 saat
    const now = Date.now();
    const keysToDelete = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('gridMaster_tr_game_')) continue;

        try {
            const state = JSON.parse(localStorage.getItem(key));
            // Sadece tamamlanmamış (move < 25) ve süresi dolmuş oyunları sil
            if (state && state.move < 25 && state.savedAt && (now - state.savedAt) > EXPIRY_MS) {
                keysToDelete.push(key);
            }
        } catch (e) {
            keysToDelete.push(key); // Bozuk kayıt, sil
        }
    }

    keysToDelete.forEach(key => localStorage.removeItem(key));
    if (keysToDelete.length > 0) {
        console.log(`Temizlendi: ${keysToDelete.length} eski yarım oyun silindi.`);
    }
}

function getGameKey(dateStr) {
    return `gridMaster_tr_game_${dateStr}`;
}

function loadGameState() {
    // Önce eski kayıtları temizle
    cleanupOldGameStates();

    const dateStr = getLocalDateStr(currentPlayingDate);
    const savedState = localStorage.getItem(getGameKey(dateStr));

    if (savedState) {
        try {
            const state = JSON.parse(savedState);
            gridData = state.grid;
            currentMove = state.move;
            console.log(`Kayıtlı oyun yüklendi: ${dateStr}, hamle: ${currentMove}`);
        } catch (e) {
            // Bozuk kayıt, temiz başla
            gridData = Array(25).fill(null);
            currentMove = 0;
        }
    } else {
        // Bu tarih için kayıt yok, temiz başla
        gridData = Array(25).fill(null);
        currentMove = 0;
    }
}

function saveGameState() {
    const dateStr = getLocalDateStr(currentPlayingDate);
    const state = {
        dateStr: dateStr,
        grid: gridData,
        move: currentMove,
        savedAt: Date.now() // Temizleme için zaman damgası
    };
    localStorage.setItem(getGameKey(dateStr), JSON.stringify(state));
}

// ==========================================
// 3. DAILY SEEDED RNG LOGIC
// ==========================================
function setupDailyContext() {
    // SİHİR BURADA: Artık bugünü değil, oynanan tarihi kullanıyoruz!
    const options = { month: 'long', day: 'numeric', year: 'numeric' };
    dateDisplay.textContent = currentPlayingDate.toLocaleDateString('tr-TR', options);
    
    const startDate = new Date("2026-03-06T00:00:00");
    const startMidnight = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const currentMidnight = new Date(currentPlayingDate.getFullYear(), currentPlayingDate.getMonth(), currentPlayingDate.getDate());
    
    const diffTime = Math.abs(currentMidnight - startMidnight);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    challengeDisplay.textContent = `No. ${diffDays}`;
    
    // Geçmiş tarihe göre benzersiz tohum (seed) üret
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
    finalSequence.push(...vowelPool.slice(0, 12));
    finalSequence.push(...consonantPool.slice(0, 12));
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
    const alphabet = "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ".split('');
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
            actionMessage.textContent = "Tekrar tıklayarak harfi yerleştirin.";
        } else {
            actionMessage.textContent = "Bir hücre seçin.";
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

// YENİ: Maksimum puanı garantileyen Rekürsif (Özyineli) Algoritma
function calculateLineData(text) {
    
    // Satırdaki en yüksek puanlı kombinasyonu bulan iç fonksiyon
    function findMaxScore(index) {
        // Eğer satırın sonuna geldiysek puan 0, kelime yok
        if (index >= text.length) {
            return { score: 0, words: [] };
        }

        // 1. SEÇENEK: Bu harfi atla (hiçbir kelimeye dahil etme) ve sonrasına bak
        let bestResult = findMaxScore(index + 1);

        // 2. SEÇENEK: Bu harften başlayan 2, 3, 4, 5 harfli geçerli kelimeleri dene
        for (let len = 2; len <= 5; len++) {
            if (index + len <= text.length) {
                const sub = text.substring(index, index + len);
                
                // Eğer sözlükte varsa
                if (dictionary.has(sub)) {
                    // Bu kelimeden SONRAKİ harflerin getireceği maksimum puanı hesapla
                    const nextResult = findMaxScore(index + len);
                    const currentTotalScore = SCORE_RULES[len] + nextResult.score;

                    // Eğer bu kombinasyon (Örn: TO + NOG) şu ana kadarki en iyisinden (Örn: TON) yüksekse, yeni lider bu!
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

    // Fonksiyonu satırın 0. indeksinden (en başından) başlat
    return findMaxScore(0);
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
    let totalScore = 0; // Doğru tanımlama burada
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

    // YENİ: Oyun bitti, sayfa artık aşağı kaydırılabilir!
    document.body.classList.remove('game-locked'); 
    
    // (BURADAKİ İKİNCİ 'let totalScore = 0;' SATIRINI SİLDİK)

    renderFinalGrid(rowScores, colScores);
    
    // YENİ: Kelimeleri temizle, sırala ve ekrana bas
    const uniqueWords = [...new Set(allFoundWords)].sort((a, b) => b.length - a.length || a.localeCompare(b));
    renderWordsList(uniqueWords);

    // 1. Oyun içi mesaj alanını GİZLE
    const messageArea = document.getElementById('game-message-area');
    if (messageArea) messageArea.classList.add('hidden');

    // 2. Oyun sonu skor alanını GÖSTER
    const endStatsArea = document.getElementById('end-game-stats-area');
    if (endStatsArea) endStatsArea.classList.remove('hidden');

    // 3. Kendi skorunu Your Score kutusuna yazdır
    const finalUserScoreVal = document.getElementById('final-user-score-value');
    if (finalUserScoreVal) finalUserScoreVal.textContent = totalScore;

    // 4. Paylaşma Butonunu aktif et
    const shareBtn = document.getElementById('btn-share-score');
    if (shareBtn) {
        shareBtn.classList.remove('hidden');
        shareBtn.onclick = () => handleShare(totalScore, rowScores, colScores);
    }
    
    // Firebase gönderimleri ve diğer hesaplamalar
    submitToFirebase(totalScore);
    updatePlayerStats(totalScore); 

    // 5. Günün en yüksek skorunu kontrol et
    const dateStr = getLocalDateStr(currentPlayingDate);
    handleDailyTopScore(totalScore, dateStr);
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

async function submitToFirebase(score) {
    if (!userId) return;

    // YENİ: Bugün yerine, oynanan tarihe (currentPlayingDate) kaydet
    const dateStr = getLocalDateStr(currentPlayingDate);

    try {
        const docRef = doc(db, "users", userId, "en", "data", "daily_scores", dateStr);
        await setDoc(docRef, {
            score: score,
            grid: gridData,
            date: dateStr,
            timestamp: new Date() // Bu kaydın yapıldığı gerçek an
        }, { merge: true });

        console.log("Archive/Daily Score saved to cloud:", dateStr);
    } catch (e) {
        console.error("Error saving score: ", e);
    }
}

// ==========================================
// 6. DEVELOPMENT TOOLS
// ==========================================

// NEW: Dev Reset mechanism to quickly test the game repeatedly
const btnDevReset = document.getElementById('btn-dev-reset');
if (btnDevReset) {
    btnDevReset.addEventListener('click', () => {
        // Bugünün oyununu LocalStorage'dan sil
        const todayKey = getGameKey(getLocalDateStr(currentPlayingDate));
        localStorage.removeItem(todayKey);
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
    modalTitle.textContent = word;
    modalDef.innerHTML = '<p class="def-text">Anlamı aranıyor...</p>';
    dictModal.classList.add('active');

    const scriptUrl = "https://script.google.com/macros/s/AKfycbyHywT-EMNS7J1eOGbALgi2TGNF-uuM9wFpsVk12gn1_Lwwz0bq6AgY7m9EuAHSKXlP/exec";

    try {
        const response = await fetch(`${scriptUrl}?word=${encodeURIComponent(word.toLocaleLowerCase('tr-TR'))}`);
        const data = await response.json();

        if (!data || !data[0] || !data[0].anlamlarListe) {
            modalDef.innerHTML = '<p class="def-text">Sözlükte bu kelimeye ait bir tanım bulunamadı.</p>';
            return;
        }

        let htmlContent = '';
        data[0].anlamlarListe.slice(0, 2).forEach(anlam => {
            htmlContent += `<div class="def-text">• ${anlam.anlam}</div>`;
        });

        modalDef.innerHTML = htmlContent;
    } catch (error) {
        modalDef.innerHTML = '<p class="def-text">Bağlantı hatası. Sözlüğe ulaşılamadı.</p>';
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

// ==========================================
// 8. ARCHIVE SYSTEM
// ==========================================
const btnArchive = document.getElementById('btn-archive');
const archiveModal = document.getElementById('archive-modal');
const closeArchiveBtn = document.getElementById('close-archive');
const archiveList = document.getElementById('archive-list');

// Orijinal HTML'indeki butonu dinliyoruz
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
        const scoresRef = collection(db, "users", userId, "en", "data", "daily_scores");
        const querySnapshot = await getDocs(scoresRef);
        
        const userScores = {};
        querySnapshot.forEach((doc) => {
            userScores[doc.id] = doc.data().score;
        });

        // Veriler çekildikten sonra arayüzü çiz
        renderArchiveUI(userScores);

    } catch (error) {
        console.error("Archive fetch error:", error);
        archiveList.innerHTML = '<p class="def-text" style="text-align: center;">Error loading archive.</p>';
    }
}

function renderArchiveUI(userScores) {
    archiveList.innerHTML = '';
    
    // Oyunun Başlangıç Tarihi: 6 Mart 2026
    const startDate = new Date("2026-03-06T00:00:00");
    const today = new Date();
    
    let currentDate = new Date(today);
    
    // Bugünden başlayıp 6 Mart'a kadar geriye doğru git
    while (currentDate >= startDate) {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`; 
        
        const displayDate = currentDate.toLocaleDateString('tr-TR', { month: 'long', day: 'numeric', year: 'numeric' });
        
        const itemDiv = document.createElement('div');
        
        if (userScores[dateStr] !== undefined) {
            // OYNANMIŞ GÜN (Yeni Tıklanabilir Buton)
            itemDiv.className = 'archive-item played';
            itemDiv.innerHTML = `
                <span class="archive-date">${displayDate}</span>
                <button class="archive-view-btn" data-date="${dateStr}">Skor: ${userScores[dateStr]} 👁️</button>
            `;
        } else {
            // OYNANMAMIŞ GÜN
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

// Arşiv listesi içindeki "Play" butonlarını dinle (Event Delegation)
if (archiveList) {
    archiveList.addEventListener('click', (e) => {
        // Hangi butona tıklandığını bul
        const playBtn = e.target.closest('.archive-play-btn');
        const viewBtn = e.target.closest('.archive-view-btn');

        if (playBtn) {
            const dateStr = playBtn.getAttribute('data-date');
            archiveModal.classList.remove('active'); 
            startSpecificDateGame(dateStr); 
        } else if (viewBtn) {
            const dateStr = viewBtn.getAttribute('data-date');
            archiveModal.classList.remove('active'); 
            viewPastGame(dateStr); // Yeni yazdığımız fonksiyonu çağırıyoruz
        }
    });
}

// YENİ: Geçmiş bir tarihi başlatma fonksiyonu (Zaman Makinesi)
function startSpecificDateGame(dateStr) {
    // 1. Tarihi ayarla (YYYY-MM-DD formatından)
    const parts = dateStr.split('-');
    currentPlayingDate = new Date(parts[0], parts[1] - 1, parts[2]);
    
    // 2. Bu tarih için kayıtlı oyun varsa yükle, yoksa temiz başla
    const savedForDate = localStorage.getItem(getGameKey(dateStr));
    if (savedForDate) {
        try {
            const state = JSON.parse(savedForDate);
            gridData = state.grid;
            currentMove = state.move;
            console.log(`Arşiv oyunu devam ettiriliyor: ${dateStr}, hamle: ${currentMove}`);
        } catch (e) {
            gridData = Array(25).fill(null);
            currentMove = 0;
        }
    } else {
        gridData = Array(25).fill(null);
        currentMove = 0;
    }
    isGameActive = currentMove < 25;
    draftIndex = null;
    jokerLetter = null;
    
    // 3. Oyun Arayüzünü Yeni Tarihe Göre Çiz
    setupDailyContext();
    
    // ==========================================
    // 5. UI SIFIRLAMA (Sorunu Çözen Kısım)
    // ==========================================
    
    // A. 6x6 final grid'i iptal et (5x5'e dön)
    gridEl.classList.remove('final-grid');
    
    // B. Kelime listesini gizle
    const wordsContainer = document.getElementById('words-list-container');
    if(wordsContainer) wordsContainer.classList.add('hidden');
    
    // C. Oyun sonu skor kutucuklarını (Your Score / Daily Best) gizle
    const endStatsArea = document.getElementById('end-game-stats-area');
    if(endStatsArea) endStatsArea.classList.add('hidden');
    
    // D. Parlayan "Yeni Rekor" sınıfını temizle (Sarı kutu kalmasın)
    const userScoreBox = document.querySelector('.user-score-box');
    if(userScoreBox) userScoreBox.classList.remove('new-record');

    // E. Paylaş butonunu gizle
    const shareBtn = document.getElementById('btn-share-score');
    if(shareBtn) shareBtn.classList.add('hidden');
    
    // F. Oyun içi mesaj satırını tekrar GÖSTER
    const messageArea = document.getElementById('game-message-area');
    if(messageArea) messageArea.classList.remove('hidden');

    // ==========================================

    // 6. Oyun durumuna göre ekranı ayarla
    if (isGameActive) {
        document.body.classList.add('game-locked');
        renderGrid();
        updateUI();
        const actionMessage = document.getElementById('action-message');
        if(actionMessage) actionMessage.textContent = "Arşiv yüklendi. Bir hücre seçin.";
    } else {
        document.body.classList.remove('game-locked');
        calculateAndSaveScore();
    }
}

// GEÇMİŞ OYUNU GÖRÜNTÜLEME FONKSİYONU
async function viewPastGame(dateStr) {
    const parts = dateStr.split('-');
    currentPlayingDate = new Date(parts[0], parts[1] - 1, parts[2]);

    // Üst bilgiyi (Tarih ve Challenge No) güncelle
    setupDailyContext();

    // UI'ı Temizle ve Kitle
    const wordsContainer = document.getElementById('words-list-container');
    if(wordsContainer) wordsContainer.classList.add('hidden');

    const endStatsArea = document.getElementById('end-game-stats-area');
    if(endStatsArea) endStatsArea.classList.add('hidden');

    const messageArea = document.getElementById('game-message-area');
    if(messageArea) {
        messageArea.classList.remove('hidden');
        document.getElementById('action-message').textContent = "Geçmiş oyun verisi yükleniyor... / Loading...";
    }

    gridEl.classList.remove('final-grid');
    gridEl.innerHTML = '';
    
    document.body.classList.add('game-locked');
    isGameActive = false;

    try {
        // Firebase'den o günkü ızgarayı (grid) çek
        const docRef = doc(db, COLLECTIONS.SCORES, `${dateStr}_${userId}`);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && docSnap.data().grid) {
            gridData = docSnap.data().grid;
            const pastScore = docSnap.data().score;

            // Puanları yeniden hesapla (Çünkü Firebase'de sadece grid harflerini tutuyoruz)
            const GRID_SIZE = 5;
            let rowScores = Array(5).fill(0);
            let colScores = Array(5).fill(0);

            for (let row = 0; row < GRID_SIZE; row++) {
                const indices = Array.from({ length: GRID_SIZE }, (_, i) => row * GRID_SIZE + i);
                rowScores[row] = calculateLineData(getLineString(indices)).score;
            }
            for (let col = 0; col < GRID_SIZE; col++) {
                const indices = Array.from({ length: GRID_SIZE }, (_, i) => i * GRID_SIZE + col);
                colScores[col] = calculateLineData(getLineString(indices)).score;
            }

            // Final grid'i ekrana çiz
            renderFinalGrid(rowScores, colScores);

            if(messageArea) messageArea.classList.add('hidden');
            if(endStatsArea) endStatsArea.classList.remove('hidden');

            // Kullanıcının o günkü skorunu yazdır
            const finalUserScoreVal = document.getElementById('final-user-score-value');
            if (finalUserScoreVal) finalUserScoreVal.textContent = pastScore;

            // O günün Günlük En İyi (Daily Best) rekorunu çek ve yazdır
            handleDailyTopScore(pastScore, dateStr);

        } else {
            // Eğer eski bir oyunsa ve grid veritabanında yoksa
            document.getElementById('action-message').textContent = "Bu tarihe ait tablo verisi bulunamadı.";
        }
    } catch (error) {
        console.error("Geçmiş oyun çekilirken hata:", error);
        document.getElementById('action-message').textContent = "Bağlantı hatası.";
    }
}

// ==========================================
// 9. HELP (HOW TO PLAY) MODAL
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

// Modal dışına tıklandığında (karanlık alana) modalları kapatma genel mantığı
document.addEventListener('click', (e) => {
    // Sadece 'active' class'ına sahip overlay'lere tıklandıysa kapat
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

function getScoreHeartEmoji(score) {
    const heartMap = {
        15: '💜', // Mor
        9:  '💙', // Mavi
        7:  '🩵', // Açık Mavi (Teal/Abuz Mavi)
        5:  '💚', // Yeşil
        4:  '💛', // Sarı
        2:  '🧡', // Turuncu
        0:  '🩶'  // Gri
    };
    return heartMap[score] || heartMap[0];
}

async function handleShare(totalScore, rowScores, colScores) {
    const challengeNo = document.getElementById('challenge-display').textContent;
    const shareLink = window.location.href;
    const emptyCell = '⬜'; // Spoiler koruması

    let gridText = "";
    
    // Satır sonlarına kalpler (5 satır)
    for (let i = 0; i < 5; i++) {
        gridText += `${emptyCell}${emptyCell}${emptyCell}${emptyCell}${emptyCell} ${getScoreHeartEmoji(rowScores[i])}\n`;
    }
    
    // Alt sütun puanları için kalpler (6. satır)
    let colLine = "";
    for (let j = 0; j < 5; j++) {
        colLine += `${getScoreHeartEmoji(colScores[j])}`;
    }
    
    const fullMessage = `Grid Master ${challengeNo}\nScore: ${totalScore}\n\n${gridText}${colLine}\n\nPlay here: ${shareLink}`;

    if (navigator.share) {
        try {
            await navigator.share({ text: fullMessage });
        } catch (err) { console.log("Share cancelled"); }
    } else {
        try {
            await navigator.clipboard.writeText(fullMessage);
            const btn = document.getElementById('btn-share-score');
            const originalText = btn.innerHTML;
            btn.innerHTML = "COPIED!";
            setTimeout(() => { btn.innerHTML = originalText; }, 2000);
        } catch (err) { alert("Could not copy."); }
    }
}

// ==========================================
// 10. STATISTICS & STREAK LOGIC
// ==========================================

async function updatePlayerStats(currentScore) {
    const user = auth.currentUser;
    if (!user) return;

    try {
        const statsRef = doc(db, "users", user.uid, "en", "data", "user_summary", "stats");
        
        // Eğer hafızada yoksa mecbur veritabanından çekeceğiz ki streak hesaplayabilelim
        if (!cachedUserStats) {
            const snap = await getDoc(statsRef);
            if (snap.exists()) {
                cachedUserStats = snap.data();
            } else {
                cachedUserStats = { played: 0, currentStreak: 0, maxStreak: 0, personalBest: 0, distribution: [0,0,0,0,0], lastPlayedDate: null };
            }
        }

        // 1. Oynanma Sayısı & En İyi Skor
        cachedUserStats.played++;
        if (currentScore > cachedUserStats.personalBest) {
            cachedUserStats.personalBest = currentScore;
        }

        // 2. Streak Hesaplama (Bugün ve Dün mantığı)
        const today = new Date();
        // Saat dilimi kaymalarını önlemek için yerel tarihi string yapıyoruz (YYYY-MM-DD)
        const todayStr = today.toLocaleDateString('en-CA'); 
        
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toLocaleDateString('en-CA');

        if (cachedUserStats.lastPlayedDate === yesterdayStr) {
            cachedUserStats.currentStreak++;
        } else if (cachedUserStats.lastPlayedDate !== todayStr) {
            // Eğer en son bugün oynanmadıysa ve dün de oynanmadıysa seri bozulmuş demektir
            cachedUserStats.currentStreak = 1; 
        }

        if (cachedUserStats.currentStreak > cachedUserStats.maxStreak) {
            cachedUserStats.maxStreak = cachedUserStats.currentStreak;
        }
        cachedUserStats.lastPlayedDate = todayStr;

        // 3. Skor Dağılımını Güncelle (0-39, 40-59, 60-79, 80-99, 100+)
        if (currentScore <= 39) cachedUserStats.distribution[0]++;
        else if (currentScore <= 59) cachedUserStats.distribution[1]++;
        else if (currentScore <= 79) cachedUserStats.distribution[2]++;
        else if (currentScore <= 99) cachedUserStats.distribution[3]++;
        else cachedUserStats.distribution[4]++;

        // 4. Firebase'e Kaydet
        await setDoc(statsRef, cachedUserStats);

    } catch (error) {
        console.error("Error updating stats:", error);
    }
}

// ==========================================
// 11. STATISTICS MODAL & LOGIC
// ==========================================

async function showStatsModal() {
    const statsModal = document.getElementById('stats-modal');
    const distContainer = document.getElementById('dist-container');
    
    // Yükleniyor durumu
    distContainer.innerHTML = '<p class="def-text" style="text-align: center;">Loading stats...</p>';
    statsModal.classList.add('active');

    // Kullanıcı girişi kontrolü (Senin Firebase auth yapına göre uyarla)
    const user = auth.currentUser; 
    if (!user) {
        distContainer.innerHTML = '<p class="def-text" style="text-align: center;">Please log in to see stats.</p>';
        return;
    }

    // Eğer veri daha önce çekilmediyse Firebase'den çek
    if (!cachedUserStats) {
        try {
            const statsRef = doc(db, "users", user.uid, "en", "data", "user_summary", "stats");
            const statsSnap = await getDoc(statsRef);
            
            if (statsSnap.exists()) {
                cachedUserStats = statsSnap.data();
            } else {
                // Hiç oynamamış kullanıcı için varsayılan değerler
                cachedUserStats = {
                    played: 0,
                    currentStreak: 0,
                    maxStreak: 0,
                    personalBest: 0,
                    distribution: [0, 0, 0, 0, 0]
                };
            }
        } catch (error) {
            console.error("Error fetching stats:", error);
            distContainer.innerHTML = '<p class="def-text" style="text-align: center;">Could not load stats.</p>';
            return;
        }
    }

    // --- Değerleri Ekrana Yazdır ---
    document.getElementById('stat-played').textContent = cachedUserStats.played;
    document.getElementById('stat-streak').textContent = cachedUserStats.currentStreak;
    document.getElementById('stat-max-streak').textContent = cachedUserStats.maxStreak;
    document.getElementById('personal-best-value').textContent = cachedUserStats.personalBest;

    // --- Dağılım Grafiğini (Bar Chart) Çiz ---
    distContainer.innerHTML = ''; // Loading yazısını temizle
    
    // Senin belirlediğin aralıklar:
    const labels = ['0-39', '40-59', '60-79', '80-99', '100+'];
    const maxVal = Math.max(...cachedUserStats.distribution); // En çok hangi aralıkta skor var?

    cachedUserStats.distribution.forEach((count, index) => {
        // En yüksek bar %100 genişlikte olur, diğerleri ona göre oranlanır.
        // Hiç yoksa bile barın görünmesi için minimum %7 genişlik veriyoruz.
        const percentage = maxVal > 0 ? (count / maxVal) * 100 : 0;
        const widthPercent = Math.max(7, percentage); 
        
        // Eğer o anki skor bu bar içindeyse, ona Wordle yeşili (highlight) sınıfı ekleyebiliriz
        // Şimdilik hepsi standart gri renkte gelecek (CSS'teki .dist-bar)
        const barHtml = `
            <div class="dist-bar-wrapper">
                <div style="width: 55px; text-align: right; padding-right: 5px;">${labels[index]}</div>
                <div style="flex-grow: 1;">
                    <div class="dist-bar" style="width: ${widthPercent}%;">${count}</div>
                </div>
            </div>
        `;
        distContainer.insertAdjacentHTML('beforeend', barHtml);
    });
}

// ==========================================
// 12. STATS MODAL EVENT LISTENERS
// ==========================================

const btnStats = document.getElementById('btn-stats');
const closeStats = document.getElementById('close-stats');
const statsModal = document.getElementById('stats-modal');

if (btnStats) {
    btnStats.addEventListener('click', showStatsModal);
}

if (closeStats) {
    closeStats.addEventListener('click', () => {
        statsModal.classList.remove('active'); // Düzeltildi
    });
}

// ==========================================
// 13. DAILY GLOBAL TOP SCORE
// ==========================================

async function handleDailyTopScore(userScore, dateStr) {
    const dailyBestVal = document.getElementById('final-daily-best-value');
    const userScoreBox = document.querySelector('.user-score-box');
    
    if (!dailyBestVal || !userScoreBox) return;

    try {
        const topScoreRef = doc(db, "daily_stats_en", dateStr);
        const docSnap = await getDoc(topScoreRef);
        
        let currentTop = 0;
        if (docSnap.exists()) {
            currentTop = docSnap.data().topScore || 0;
        }

        // Skorları kutulara yazdır
        dailyBestVal.textContent = currentTop;

        if (userScore >= currentTop && userScore > 0) {
            // 👑 Yeni rekor! (Sadece 0'dan büyükse rekor sayalım)
            await setDoc(topScoreRef, { topScore: userScore }, { merge: true });
            
            // Daily Best değerini anında güncelle
            dailyBestVal.textContent = userScore;
            
            // Your Score kutusunu parlat (CSS class ekle)
            userScoreBox.classList.add('new-record');
        } else {
            userScoreBox.classList.remove('new-record');
        }

    } catch (error) {
        console.error("Error handling top score:", error);
    }
}

// ==========================================
// 14. DARK MODE LOGIC
// ==========================================
const btnTheme = document.getElementById('btn-theme');
const iconMoon = document.getElementById('theme-icon-moon');
const iconSun = document.getElementById('theme-icon-sun');

// 1. Sayfa yüklendiğinde eski tercihi kontrol et
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('gridMaster_tr_theme');
    
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        if (iconMoon && iconSun) {
            iconMoon.classList.add('hidden');
            iconSun.classList.remove('hidden');
        }
    }
});

// 2. Butona basıldığında temayı değiştir ve kaydet
if (btnTheme) {
    btnTheme.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        
        if (isDark) {
            localStorage.setItem('gridMaster_tr_theme', 'dark');
            iconMoon.classList.add('hidden');
            iconSun.classList.remove('hidden');
        } else {
            localStorage.setItem('gridMaster_tr_theme', 'light');
            iconSun.classList.add('hidden');
            iconMoon.classList.remove('hidden');
        }
    });
}
