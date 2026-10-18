// ==UserScript==
// @name         AINS NILAM Auto Filler (Draggable/Resizable UI + Stats)
// @namespace    http://tampermonkey.net/
// @version      2.5.0
// @description  Fills wizard up to Step 4, checks confirmation, persists 3-min timer, auto-advances book queue, draggable/resizable UI, and tracks books filled & Carta rank.
// @match        https://ains.moe.gov.my/*
// @include      *nilam*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Prevent background tab throttling via Web Worker
    const timerWorker = new Worker(URL.createObjectURL(new Blob([`
        self.onmessage = function(e) {
            setTimeout(function() {
                self.postMessage(e.data);
            }, e.data.delay);
        };
    `], { type: 'application/javascript' })));

    function safeTimeout(callback, delay) {
        const id = Math.random();
        const handler = function(e) {
            if (e.data.id === id) {
                timerWorker.removeEventListener('message', handler);
                callback();
            }
        };
        timerWorker.addEventListener('message', handler);
        timerWorker.postMessage({ id: id, delay: delay });
    }

    // Request Notification Permission on Script Load
    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }

    // Trigger Native Desktop Notification Popup
    function triggerDesktopNotification() {
        if ('Notification' in window && Notification.permission === 'granted') {
            const notif = new Notification('AINS NILAM Timer Complete! 📚', {
                body: '3 minutes are up! You can now submit your next book record.',
                icon: 'https://ains.moe.gov.my/favicon.ico',
                requireInteraction: true
            });

            notif.onclick = function() {
                window.focus();
                this.close();
            };
        }
    }

    // Play audio alert when timer hits zero
    function playAudioAlert() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, idx) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.3, audioCtx.currentTime + idx * 0.15);
                gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + idx * 0.15 + 0.3);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(audioCtx.currentTime + idx * 0.15);
                osc.stop(audioCtx.currentTime + idx * 0.15 + 0.3);
            });
        } catch(e) {}
    }

    // Advance book dropdown queue to the next item
    function advanceToNextBook() {
        if (!loadedBooks || !loadedBooks.length) return;
        const currentIdx = parseInt(bookSelect.value || '0', 10);
        const nextIdx = (currentIdx + 1) % loadedBooks.length;

        bookSelect.value = nextIdx;
        localStorage.setItem('ains_books_index', nextIdx.toString());
    }

    // Increment Total Books Filled Counter
    function incrementBooksFilledCount() {
        let count = parseInt(localStorage.getItem('ains_books_filled_count') || '0', 10);
        count++;
        localStorage.setItem('ains_books_filled_count', count.toString());
        updateStatsDisplay();
    }

    // Scrape Carta Pendahuluan rank from page if present
    function getCartaRank() {
        let rankText = localStorage.getItem('ains_carta_rank') || 'N/A';
        const elements = document.querySelectorAll('div, tr, td, span, p');

        for (let el of elements) {
            const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
            if (txt.includes('kedudukan') || txt.includes('carta pendahuluan') || txt.includes('ranking')) {
                const match = (el.innerText || el.textContent).match(/(?:#|kedudukan|rank)\s*(\d+)/i) || (el.parentElement?.innerText || '').match(/(\d+)/);
                if (match && match[1]) {
                    rankText = '#' + match[1];
                    localStorage.setItem('ains_carta_rank', rankText);
                    break;
                }
            }
        }
        return rankText;
    }

    // Update GUI Stats
    function updateStatsDisplay() {
        const filledDiv = document.getElementById('ains-stats-filled');
        const rankDiv = document.getElementById('ains-stats-rank');

        const filledCount = localStorage.getItem('ains_books_filled_count') || '0';
        const rank = getCartaRank();

        if (filledDiv) filledDiv.innerText = `📖 Books Filled: ${filledCount}`;
        if (rankDiv) rankDiv.innerText = `🏆 Carta Rank: ${rank}`;
    }

    // Persistent Timer logic
    function startCooldownTimer(durationSeconds = 180) {
        let endTime = localStorage.getItem('ains_cooldown_end_time');

        if (!endTime || parseInt(endTime, 10) <= Date.now()) {
            endTime = Date.now() + (durationSeconds * 1000);
            localStorage.setItem('ains_cooldown_end_time', endTime.toString());
            advanceToNextBook();
            incrementBooksFilledCount();
        } else {
            endTime = parseInt(endTime, 10);
        }

        let statusDiv = document.getElementById('ains-timer-status');
        if (!statusDiv) {
            statusDiv = document.createElement('div');
            statusDiv.id = 'ains-timer-status';
            statusDiv.style.cssText = 'font-size: 11px; font-weight: bold; color: #d97706; text-align: center; margin-top: 4px;';
            container.appendChild(statusDiv);
        }

        if (window.ainsTimerInterval) clearInterval(window.ainsTimerInterval);

        window.ainsTimerInterval = setInterval(() => {
            const remainingMs = endTime - Date.now();
            const remainingSec = Math.ceil(remainingMs / 1000);

            if (remainingSec <= 0) {
                clearInterval(window.ainsTimerInterval);
                localStorage.removeItem('ains_cooldown_end_time');
                statusDiv.innerText = '🔔 3 minutes up! Ready for next book.';
                statusDiv.style.color = '#16a34a';
                playAudioAlert();
                triggerDesktopNotification();
            } else {
                const m = Math.floor(remainingSec / 60);
                const s = remainingSec % 60;
                statusDiv.innerText = `⏳ Cooldown: ${m}:${s < 10 ? '0' : ''}${s}`;
                statusDiv.style.color = '#d97706';
            }
        }, 1000);
    }

    function checkAndResumeTimer() {
        const endTime = localStorage.getItem('ains_cooldown_end_time');
        if (endTime && parseInt(endTime, 10) > Date.now()) {
            startCooldownTimer();
        }
    }

    // Framework Input Setter
    function setInputValue(el, value) {
        if (!el) return;

        if (el.tagName === 'SELECT') {
            let matched = false;
            const searchVal = String(value).trim().toLowerCase();
            for (let option of el.options) {
                const optText = option.textContent.trim().toLowerCase();
                const optVal = option.value.trim().toLowerCase();
                if (optText === searchVal || optVal === searchVal || optText.includes(searchVal) || searchVal.includes(optText)) {
                    el.value = option.value;
                    matched = true;
                    break;
                }
            }
            if (!matched && el.options.length > 1) el.selectedIndex = 1;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        const valueSetter = Object.getOwnPropertyDescriptor(el, 'value')?.set;
        const prototype = Object.getPrototypeOf(el);
        const prototypeValueSetter = Object.getPrototypeOf(prototype) ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set : null;

        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(el, value);
        } else if (valueSetter) {
            valueSetter.call(el, value);
        } else {
            el.value = value;
        }

        ['input', 'change', 'blur', 'keyup'].forEach(eventType => {
            el.dispatchEvent(new Event(eventType, { bubbles: true }));
        });
    }

    function fillChoiceField(labelKeywords, value) {
        if (!value) return;
        const valStr = String(value).trim().toLowerCase();

        const containers = document.querySelectorAll('.col, .row, .form-group, div, tr');
        containers.forEach(container => {
            const textHeader = (container.innerText || container.textContent || '').toLowerCase();
            if (labelKeywords.some(kw => textHeader.includes(kw.toLowerCase()))) {
                const select = container.querySelector('select');
                if (select) setInputValue(select, value);

                const customOptions = container.querySelectorAll('[role="option"], .dropdown-item, li, option');
                customOptions.forEach(opt => {
                    const txt = (opt.innerText || opt.textContent || opt.value || '').trim().toLowerCase();
                    if (txt && (txt === valStr || txt.includes(valStr) || valStr.includes(txt))) {
                        try { opt.click(); } catch(e){}
                    }
                });
            }
        });
    }

    function fillFieldByLabel(labelKeywords, value, fallbackSelector) {
        if (value === undefined || value === null || value === '') return;

        let filled = false;
        const labels = document.querySelectorAll('label, div.form-label, span, th, p, div');

        for (const label of labels) {
            const labelText = (label.innerText || label.textContent || '').trim().toLowerCase();
            if (labelText.length > 60) continue;

            if (labelKeywords.some(kw => labelText.includes(kw.toLowerCase()))) {
                const container = label.closest('.form-group, .mb-3, .col, .row, div, tr, td') || label.parentElement;
                if (container) {
                    const input = container.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, select');
                    if (input) {
                        setInputValue(input, value);
                        filled = true;
                        break;
                    }
                }
            }
        }

        if (!filled && fallbackSelector) {
            const elements = document.querySelectorAll(fallbackSelector);
            elements.forEach(el => setInputValue(el, value));
        }
    }

    function getRandomDate() {
        const start = new Date('2025-01-01').getTime();
        const end = new Date().getTime();
        const d = new Date(start + Math.random() * (end - start));
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function fillRandomDate() {
        const isoDate = getRandomDate();
        const dateInputs = document.querySelectorAll('input[type="date"], input[name*="tarikh"], input[id*="tarikh"], input[placeholder*="tarikh"]');
        dateInputs.forEach(input => setInputValue(input, isoDate));
    }

    function fillRandomRating() {
        const score = Math.floor(Math.random() * 2) + 4;
        try {
            const safeClick = (el) => {
                if (!el) return;
                if (el.tagName === 'INPUT') {
                    el.checked = true;
                    setInputValue(el, score);
                    return;
                }
                const evt = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
                Object.defineProperty(evt, 'point', { value: { x: 10, y: 10 }, configurable: true });
                el.dispatchEvent(evt);
            };

            const radios = document.querySelectorAll('input[type="radio"]');
            radios.forEach(radio => {
                const context = (radio.name + radio.id + radio.value + (radio.parentElement?.textContent || '')).toLowerCase();
                if ((context.includes('penilaian') || context.includes('rating') || context.includes('bintang') || context.includes('skor')) && radio.value == score) {
                    radio.checked = true;
                    setInputValue(radio, score);
                    safeClick(radio);
                }
            });

            const starContainers = document.querySelectorAll('.vue-star-rating, .rating, .stars, [class*="rating"], [class*="bintang"], [class*="star"]');
            starContainers.forEach(container => {
                const stars = container.querySelectorAll('input, label, button, [role="radio"], .vue-star-rating-star');
                if (stars.length >= 5 && stars[score - 1]) {
                    safeClick(stars[score - 1]);
                }
            });
        } catch (e) {}
    }

    function clickNextButton() {
        const buttons = document.querySelectorAll('button, a');
        for (let btn of buttons) {
            const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            if (txt.includes('seterusnya') || txt.includes('next')) {
                btn.click();
                return true;
            }
        }
        return false;
    }

    function checkConfirmationBox() {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            if (!cb.checked) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
                cb.dispatchEvent(new Event('input', { bubbles: true }));
                cb.click();
            }
        });

        const labels = document.querySelectorAll('label, div, span, p');
        labels.forEach(el => {
            const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
            if (txt.includes('sahkan maklumat') || txt.includes('adalah betul')) {
                const cb = el.querySelector('input[type="checkbox"]') || el.parentElement?.querySelector('input[type="checkbox"]');
                if (cb && !cb.checked) {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                    cb.click();
                } else {
                    try { el.click(); } catch(e){}
                }
            }
        });
    }

    function executeFillStep(book) {
        if (!book) return;

        fillChoiceField(['kategori'], book.category || 'Buku Kartun');
        fillChoiceField(['jenis', 'jenis bahan'], book.type || 'Buku');
        fillChoiceField(['bahasa'], book.language || 'Bahasa Melayu');

        fillFieldByLabel(['tajuk', 'title'], book.title, '#title, #tajuk, input[name*="tajuk"]');
        fillFieldByLabel(['tahun terbitan', 'tahun'], book.year, 'input[name*="tahun"]');
        fillFieldByLabel(['penulis', 'author'], book.author, 'input[name*="penulis"]');
        fillFieldByLabel(['isbn'], book.isbn, 'input[name*="isbn"]');
        fillFieldByLabel(['bilangan mukasurat', 'mukasurat', 'muka'], book.pages, 'input[name*="mukasurat"]');
        fillFieldByLabel(['penerbit', 'publisher'], book.publisher, 'input[name*="penerbit"]');
        fillFieldByLabel(['pautan', 'laman web', 'url'], book.url || '', 'input[name*="pautan"]');

        fillFieldByLabel(['sinopsis', 'rumusan', 'synopsis'], book.synopsis, 'textarea');
        fillFieldByLabel(['pengajaran', 'moral'], book.moral_lesson, 'textarea[name*="pengajaran"]');
        fillRandomDate();
        fillRandomRating();
    }

    function runAutoSequence(book) {
        executeFillStep(book);

        safeTimeout(() => {
            clickNextButton();
            safeTimeout(() => {
                executeFillStep(book);
                safeTimeout(() => {
                    clickNextButton();
                    safeTimeout(() => {
                        executeFillStep(book);
                        safeTimeout(() => {
                            clickNextButton();
                            safeTimeout(() => {
                                checkConfirmationBox();
                            }, 400);
                        }, 400);
                    }, 400);
                }, 400);
            }, 400);
        }, 400);
    }

    // Trigger timer upon manual submission
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button, a, input[type="submit"]');
        if (btn) {
            const txt = (btn.innerText || btn.textContent || btn.value || '').trim().toLowerCase();
            if (txt.includes('hantar rekod') || txt.includes('hantar')) {
                startCooldownTimer(180);
            }
        }
    }, true);

    // Build Draggable & Resizable UI
    const container = document.createElement('div');
    container.id = 'ains-autofill-ui';

    // Load saved position and sizing
    const savedTop = localStorage.getItem('ains_ui_top') || 'auto';
    const savedLeft = localStorage.getItem('ains_ui_left') || 'auto';
    const savedBottom = savedTop === 'auto' ? (localStorage.getItem('ains_ui_bottom') || '20px') : 'auto';
    const savedRight = savedLeft === 'auto' ? (localStorage.getItem('ains_ui_right') || '20px') : 'auto';
    const savedWidth = localStorage.getItem('ains_ui_width') || '270px';
    const savedHeight = localStorage.getItem('ains_ui_height') || 'auto';

    container.style.cssText = `position:fixed;top:${savedTop};left:${savedLeft};bottom:${savedBottom};right:${savedRight};width:${savedWidth};height:${savedHeight};min-width:220px;min-height:220px;z-index:2147483647;background:#ffffff;padding:12px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.2);font-family:sans-serif;display:flex;flex-direction:column;gap:8px;border:1px solid #ddd;resize:both;overflow:auto;`;

    // Header handle for dragging
    const header = document.createElement('div');
    header.innerText = '✨ AINS NILAM Auto Filler';
    header.style.cssText = 'font-size: 13px; font-weight: bold; color: #1e40af; cursor: move; border-bottom: 1px solid #eee; padding-bottom: 4px; user-select: none;';

    // Stats Section Display
    const statsContainer = document.createElement('div');
    statsContainer.style.cssText = 'background: #f8fafc; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0; font-size: 11px; color: #334155; display: flex; flex-direction: column; gap: 2px;';

    const filledDiv = document.createElement('div');
    filledDiv.id = 'ains-stats-filled';
    filledDiv.innerText = '📖 Books Filled: 0';

    const rankDiv = document.createElement('div');
    rankDiv.id = 'ains-stats-rank';
    rankDiv.innerText = '🏆 Carta Rank: N/A';

    statsContainer.appendChild(filledDiv);
    statsContainer.appendChild(rankDiv);

    const label = document.createElement('label');
    label.innerText = '1. Upload books.json:';
    label.style.cssText = 'font-size: 11px; font-weight: bold; color: #333; margin-top: 4px;';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.cssText = 'font-size: 11px;';

    const selectLabel = document.createElement('label');
    selectLabel.innerText = '2. Current Book Queue:';
    selectLabel.style.cssText = 'font-size: 11px; font-weight: bold; color: #333; display: none;';

    const bookSelect = document.createElement('select');
    bookSelect.style.cssText = 'padding: 4px; font-size: 11px; display: none;';

    const fillBtn = document.createElement('button');
    fillBtn.innerText = '⚡ Fill & Auto-Advance Wizard';
    fillBtn.style.cssText = 'background: #2563eb; color: white; border: none; padding: 8px; border-radius: 4px; font-weight: bold; cursor: pointer; display: none;';

    let loadedBooks = [];
    let isDropdownInitialized = false;

    function renderBookDropdown() {
        if (!loadedBooks || !loadedBooks.length) return;

        bookSelect.innerHTML = '';
        loadedBooks.forEach((book, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = (index + 1) + '. ' + (book.title || 'Untitled');
            bookSelect.appendChild(option);
        });

        if (!isDropdownInitialized) {
            const savedIndex = localStorage.getItem('ains_books_index');
            const targetIdx = savedIndex ? parseInt(savedIndex, 10) : 0;
            bookSelect.value = (targetIdx < loadedBooks.length && targetIdx >= 0) ? targetIdx : 0;
            isDropdownInitialized = true;
        }

        selectLabel.style.display = 'block';
        bookSelect.style.display = 'block';
        fillBtn.style.display = 'block';
    }

    try {
        const savedBooks = localStorage.getItem('ains_books_json');
        if (savedBooks) {
            loadedBooks = JSON.parse(savedBooks);
        }
    } catch(e) {}

    bookSelect.addEventListener('change', (e) => {
        const selectedVal = e.target.value;
        localStorage.setItem('ains_books_index', selectedVal);
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                loadedBooks = JSON.parse(evt.target.result);
                localStorage.setItem('ains_books_json', JSON.stringify(loadedBooks));
                localStorage.setItem('ains_books_index', '0');
                isDropdownInitialized = false;
                renderBookDropdown();
            } catch (err) {
                alert('Invalid JSON file format!');
            }
        };
        reader.readAsText(file);
    });

    fillBtn.addEventListener('click', () => {
        requestNotificationPermission();
        const selectedIndex = parseInt(bookSelect.value, 10);
        const book = loadedBooks[selectedIndex];
        runAutoSequence(book);
    });

    fillBtn.addEventListener('dblclick', () => {
        advanceToNextBook();
    });

    // Make GUI Draggable
    let isDragging = false;
    let offsetX = 0, offsetY = 0;

    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - container.offsetLeft;
        offsetY = e.clientY - container.offsetTop;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const newLeft = e.clientX - offsetX;
        const newTop = e.clientY - offsetY;

        container.style.left = `${newLeft}px`;
        container.style.top = `${newTop}px`;
        container.style.right = 'auto';
        container.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = '';
            localStorage.setItem('ains_ui_left', container.style.left);
            localStorage.setItem('ains_ui_top', container.style.top);
            localStorage.removeItem('ains_ui_right');
            localStorage.removeItem('ains_ui_bottom');
        }
    });

    // Save resize dimensions
    new ResizeObserver(() => {
        if (container.style.width) localStorage.setItem('ains_ui_width', container.style.width);
        if (container.style.height) localStorage.setItem('ains_ui_height', container.style.height);
    }).observe(container);

    container.appendChild(header);
    container.appendChild(statsContainer);
    container.appendChild(label);
    container.appendChild(fileInput);
    container.appendChild(selectLabel);
    container.appendChild(bookSelect);
    container.appendChild(fillBtn);

    function initUI() {
        if (document.body && !document.getElementById('ains-autofill-ui')) {
            document.body.appendChild(container);
            renderBookDropdown();
            checkAndResumeTimer();
            requestNotificationPermission();
            updateStatsDisplay();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }

    setInterval(() => {
        initUI();
        updateStatsDisplay();
    }, 1000);
})();
