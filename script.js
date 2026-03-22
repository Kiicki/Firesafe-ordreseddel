const STORAGE_KEY = 'firesafe_ordresedler';
const ARCHIVE_KEY = 'firesafe_arkiv';
const TEMPLATE_KEY = 'firesafe_maler';
const SETTINGS_KEY = 'firesafe_settings';
const DEFAULTS_KEY = 'firesafe_defaults';
const MATERIALS_KEY = 'firesafe_materials';
const REQUIRED_KEY = 'firesafe_required';
const SERVICE_DEFAULTS_KEY = 'firesafe_defaults_service';
const SERVICE_STORAGE_KEY = 'firesafe_service';
const SERVICE_ARCHIVE_KEY = 'firesafe_service_arkiv';

const DEV_MODE = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

let authReady = false; // true after first onAuthStateChanged
let cachedRequiredSettings = null;
function sortAlpha(arr) { arr.sort((a, b) => a.localeCompare(b, 'no')); }
function sortUnits(arr) { arr.sort((a, b) => (a.plural || '').localeCompare(b.plural || '', 'no')); }

// Safe JSON parse from localStorage - prevents crash on corrupt data
function safeParseJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v || fallback; }
    catch(e) { console.error('Corrupt localStorage key:', key); return fallback; }
}

// Safe localStorage write - prevents crash on quota exceeded
function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); }
    catch(e) { console.error('localStorage quota exceeded:', key); }
}

// Global HTML escape function - prevents XSS attacks
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================
// FLERSPRÅK
// ============================================
let currentLang = localStorage.getItem('firesafe_lang') || 'no';

function t(key, ...args) {
    let str = (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) || (TRANSLATIONS['no'] && TRANSLATIONS['no'][key]) || key;
    args.forEach((val, i) => { str = str.replace('{' + i + '}', val); });
    return str;
}

function setLanguage(lang) {
    currentLang = lang;
    safeSetItem('firesafe_lang', lang);
    applyTranslations();
    // Save to Firebase if logged in
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings').doc('language').set({ lang }).catch(() => {});
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    // Update login button
    updateLoginButton();
    // Update language checkmarks
    const checkNo = document.getElementById('lang-check-no');
    const checkEn = document.getElementById('lang-check-en');
    if (checkNo) checkNo.textContent = currentLang === 'no' ? '\u2713' : '';
    if (checkEn) checkEn.textContent = currentLang === 'en' ? '\u2713' : '';
    // Re-number order cards
    renumberOrders();
}

// ============================================
// FIREBASE KONFIGURASJON
// Fyll inn dine egne verdier fra Firebase Console
// ============================================
const firebaseConfig = {
    apiKey: "AIzaSyDeo-InG090ISeP-C_oLYS63cpXGB9SLHo",
    authDomain: "firesafe-ordreseddler.firebaseapp.com",
    projectId: "firesafe-ordreseddler",
    storageBucket: "firesafe-ordreseddler.firebasestorage.app",
    messagingSenderId: "410377100638",
    appId: "1:410377100638:web:cc1c59765535198d5f43cf"
};

// Initialize Firebase
let db = null;
let auth = null;
let currentUser = null;
let isAdmin = localStorage.getItem('firesafe_admin') === '1';

try {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
    }
} catch (e) {
    // Firebase not configured
}

// Enable offline persistence for faster reads/writes
if (db) {
    db.enablePersistence({ synchronizeTabs: true }).catch(function(err) {
        if (err.code === 'failed-precondition') {
            console.warn('Firestore persistence: multiple tabs open');
        } else if (err.code === 'unimplemented') {
            console.warn('Firestore persistence not supported');
        }
    });
}

// Check if user is admin
async function checkAdminStatus(uid) {
    if (!db || !uid) return false;
    try {
        const doc = await db.collection('admins').doc(uid).get();
        return doc.exists;
    } catch (e) {
        return false;
    }
}

// Auth state listener
if (auth) {
    auth.onAuthStateChanged(function(user) {
        authReady = true;
        currentUser = user;
        isAdmin = false;
        localStorage.removeItem('firesafe_admin');
        updateLoginButton();
        loadedForms = [];

        if (!user) {
            // Dev bypass: skip login screen on local dev
            if (DEV_MODE) {
                currentUser = { uid: 'dev-local', email: 'dev@localhost', displayName: 'Dev Mode' };
                isAdmin = true;
                safeSetItem('firesafe_logged_in', '1');
                updateLoginButton();
                showTemplateModal();
                return;
            }
            window._explicitLogout = false;
            if (localStorage.getItem('firesafe_logged_in')) {
                // Kan være midlertidig null under auth-init. Vent før vi rydder.
                setTimeout(function() {
                    if (!currentUser) {
                        localStorage.removeItem('firesafe_logged_in');
                        sessionStorage.removeItem('firesafe_current');
                        sessionStorage.removeItem('firesafe_current_sent');
                        showView('login-view');
                        var loginCard = document.getElementById('login-card');
                        if (loginCard) loginCard.style.display = '';
                        document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open');
                    }
                }, 3000);
                return;
            }
            sessionStorage.removeItem('firesafe_current');
            sessionStorage.removeItem('firesafe_current_sent');
            showView('login-view');
            var loginCard = document.getElementById('login-card');
            if (loginCard) loginCard.style.display = '';
            document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open');
            return;
        }

        // Ignore stale auth events after explicit logout
        if (window._explicitLogout) {
            window._explicitLogout = false;
            return;
        }

        // Clear cached data when switching to a different user
        var lastUid = localStorage.getItem('firesafe_last_uid');
        if (lastUid && lastUid !== user.uid) {
            [SETTINGS_KEY, DEFAULTS_KEY, MATERIALS_KEY, REQUIRED_KEY, USED_NUMBERS_KEY,
             STORAGE_KEY, ARCHIVE_KEY, TEMPLATE_KEY,
             'firesafe_lang']
                .forEach(function(key) { localStorage.removeItem(key); });
            cachedRequiredSettings = null;
            currentLang = 'no';
            applyTranslations();
            if (typeof resetPaginationState === 'function') resetPaginationState();
        }
        safeSetItem('firesafe_last_uid', user.uid);

        safeSetItem('firesafe_logged_in', '1');

        var wasOnLogin = document.getElementById('login-view').classList.contains('active');

        if (db) {
            // Show template modal immediately (cache-first)
            if (wasOnLogin) showTemplateModal();

            // Sync everything in background (non-blocking)
            Promise.all([
                checkAdminStatus(user.uid).then(function(admin) {
                    isAdmin = admin;
                    if (admin) safeSetItem('firesafe_admin', '1');
                }).catch(function() {}),
                db.collection('users').doc(user.uid).collection('settings').doc('language').get().then(function(doc) {
                    if (doc.exists && doc.data().lang) {
                        currentLang = doc.data().lang;
                        safeSetItem('firesafe_lang', currentLang);
                        applyTranslations();
                    }
                }).catch(function() {}),
                syncOrderNumberIndex().catch(function() {}),
                syncDefaultsToLocal().catch(function() {}),
                syncSettingsToLocal().catch(function() {}),
                typeof getDropdownOptions === 'function' ? getDropdownOptions().catch(function() {}) : Promise.resolve(),
                typeof getRequiredSettings === 'function' ? getRequiredSettings().then(function(data) {
                    cachedRequiredSettings = data;
                    if (typeof updateRequiredIndicators === 'function') updateRequiredIndicators();
                }).catch(function() {}) : Promise.resolve(),
                typeof getTemplates === 'function' ? getTemplates().then(function(result) {
                    _templateLastDoc = result.lastDoc;
                    _templateHasMore = result.hasMore;
                    safeSetItem(TEMPLATE_KEY, JSON.stringify(result.forms.slice(0, 50)));
                    window.loadedTemplates = result.forms;
                    // Refresh template modal if still visible
                    if (document.body.classList.contains('template-modal-open')) {
                        var active = result.forms.filter(function(t) { return t.active !== false; });
                        renderTemplateList(active, false, _templateHasMore);
                    }
                }).catch(function() {}) : Promise.resolve()
            ]).then(function() {
                if (typeof refreshActiveView === 'function') refreshActiveView();
            });
        } else if (wasOnLogin) {
            showTemplateModal();
        }
    });
}

function updateLoginButton() {
    const btn = document.getElementById('btn-login-home');
    if (!btn) return;

    if (currentUser) {
        var email = currentUser.email || currentUser.displayName || '';
        btn.textContent = email;
        btn.classList.add('logged-in');
        safeSetItem('firesafe_email', email);
    } else if (!localStorage.getItem('firesafe_logged_in')) {
        // Bare vis "Logg inn" hvis vi vet at brukeren IKKE er innlogget.
        // Unngå å overskrive cached e-post mens Firebase verifiserer token.
        btn.textContent = t('login');
        btn.classList.remove('logged-in');
        localStorage.removeItem('firesafe_email');
    }
}

function handleAuth() {
    if (!auth) {
        showNotificationModal(t('firebase_not_configured'));
        return;
    }

    var onLoggedInView = document.body.classList.contains('settings-modal-open') ||
        document.body.classList.contains('template-modal-open') ||
        document.body.classList.contains('saved-modal-open') ||
        document.getElementById('view-form').classList.contains('active');

    if (currentUser || onLoggedInView) {
        // Logg ut
        showConfirmModal(t('logout_confirm'), () => {
            // Rydd opp umiddelbart — ikke vent på Firebase nettverkskall
            // Behold firesafe_last_uid — trengs for å oppdage brukerbytte ved neste innlogging
            localStorage.removeItem('firesafe_logged_in');
            sessionStorage.removeItem('firesafe_current');
            sessionStorage.removeItem('firesafe_current_sent');
            currentUser = null;
            isAdmin = false;
            window._explicitLogout = true;
            document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open');
            history.replaceState(null, '', window.location.pathname);
            showView('login-view');
            var loginCard = document.getElementById('login-card');
            if (loginCard) loginCard.style.display = '';
            updateLoginButton();
            // SignOut i bakgrunnen
            auth.signOut().then(() => {
                showNotificationModal(t('logout_success'), true);
            });
        }, t('logout'), '#6c757d');
    } else {
        showActionPopup(t('login_choose_provider'), [
            { label: '<svg width="18" height="18" viewBox="0 0 48 48" style="vertical-align:middle;margin-right:8px"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24.04 24.04 0 000 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Google', onclick: 'signInWithGoogle()' },
            { label: '<svg width="18" height="18" viewBox="0 0 23 23" style="vertical-align:middle;margin-right:8px"><rect x="1" y="1" width="10" height="10" fill="#f25022"/><rect x="12" y="1" width="10" height="10" fill="#7fba00"/><rect x="1" y="12" width="10" height="10" fill="#00a4ef"/><rect x="12" y="12" width="10" height="10" fill="#ffb900"/></svg> Microsoft', onclick: 'signInWithMicrosoft()' }
        ]);
    }
}

function signInWithGoogle() {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider)
        .then(function(result) {
            showNotificationModal(t('login_success') + result.user.email, true);
        })
        .catch(function(error) {
            if (error.code !== 'auth/popup-closed-by-user') {
                showNotificationModal(t('login_failed') + error.message);
            }
        });
}

function signInWithMicrosoft() {
    var provider = new firebase.auth.OAuthProvider('microsoft.com');
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(provider)
        .then(function(result) {
            showNotificationModal(t('login_success') + result.user.email, true);
        })
        .catch(function(error) {
            if (error.code !== 'auth/popup-closed-by-user') {
                showNotificationModal(t('login_failed') + error.message);
            }
        });
}

// Paginated Firestore helpers — returns { forms, lastDoc, hasMore }
var PAGE_SIZE = 50;

async function getSavedForms(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('forms').orderBy('savedAt', 'desc').limit(PAGE_SIZE);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return { forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }), lastDoc: snapshot.docs[snapshot.docs.length - 1] || null, hasMore: snapshot.docs.length === PAGE_SIZE };
        } catch (e) {
            console.error('Firestore error:', e);
            return { forms: safeParseJSON(STORAGE_KEY, []), lastDoc: null, hasMore: false };
        }
    }
    if (auth && !authReady) return { forms: [], lastDoc: null, hasMore: false };
    return { forms: safeParseJSON(STORAGE_KEY, []), lastDoc: null, hasMore: false };
}

async function getSentForms(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('archive').orderBy('savedAt', 'desc').limit(PAGE_SIZE);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return { forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }), lastDoc: snapshot.docs[snapshot.docs.length - 1] || null, hasMore: snapshot.docs.length === PAGE_SIZE };
        } catch (e) {
            console.error('Firestore error:', e);
            return { forms: safeParseJSON(ARCHIVE_KEY, []), lastDoc: null, hasMore: false };
        }
    }
    if (auth && !authReady) return { forms: [], lastDoc: null, hasMore: false };
    return { forms: safeParseJSON(ARCHIVE_KEY, []), lastDoc: null, hasMore: false };
}

// --- Order number index (lightweight cache of all used order numbers) ---
const USED_NUMBERS_KEY = 'firesafe_used_numbers';

async function syncOrderNumberIndex() {
    if (!currentUser || !db) return;
    var settingsRef = db.collection('users').doc(currentUser.uid).collection('settings').doc('usedNumbers');
    var doc = await settingsRef.get();
    if (doc.exists && doc.data().numbers) {
        safeSetItem(USED_NUMBERS_KEY, JSON.stringify(doc.data().numbers));
    } else {
        // Migrasjon: første gang — scan collections én gang og lagre til Firestore-dokument
        const numbers = new Set();
        const collections = ['forms', 'archive'];
        var snaps = await Promise.all(collections.map(function(col) {
            return db.collection('users').doc(currentUser.uid).collection(col).get().catch(function() { return { docs: [] }; });
        }));
        snaps.forEach(function(snap) {
            snap.docs.forEach(function(d) {
                var nr = d.data().ordreseddelNr;
                if (nr) numbers.add(String(nr));
            });
        });
        var arr = [...numbers];
        safeSetItem(USED_NUMBERS_KEY, JSON.stringify(arr));
        if (arr.length > 0) {
            settingsRef.set({ numbers: arr }, { merge: true }).catch(function(e) {
                console.error('Migration usedNumbers:', e);
            });
        }
    }
}

function addToOrderNumberIndex(nr) {
    if (!nr) return;
    var nums = safeParseJSON(USED_NUMBERS_KEY, []);
    var s = String(nr);
    if (nums.indexOf(s) === -1) {
        nums.push(s);
        safeSetItem(USED_NUMBERS_KEY, JSON.stringify(nums));
    }
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings')
            .doc('usedNumbers').set({ numbers: firebase.firestore.FieldValue.arrayUnion(s) }, { merge: true })
            .catch(function(e) { console.error('addToOrderNumberIndex Firestore:', e); });
    }
}

function removeFromOrderNumberIndex(nr) {
    if (!nr) return;
    var nums = safeParseJSON(USED_NUMBERS_KEY, []);
    var s = String(nr);
    var idx = nums.indexOf(s);
    if (idx !== -1) {
        nums.splice(idx, 1);
        safeSetItem(USED_NUMBERS_KEY, JSON.stringify(nums));
    }
    if (currentUser && db) {
        db.collection('users').doc(currentUser.uid).collection('settings')
            .doc('usedNumbers').set({ numbers: firebase.firestore.FieldValue.arrayRemove(s) }, { merge: true })
            .catch(function(e) { console.error('removeFromOrderNumberIndex Firestore:', e); });
    }
}

// Track last saved form data for unsaved changes detection
let lastSavedData = null;

function getFormDataSnapshot() {
    const data = getFormData();
    delete data.savedAt;
    return JSON.stringify(data);
}

// Confirmation modal
let pendingConfirmAction = null;

function showConfirmModal(message, onConfirm, buttonText, buttonColor) {
    document.getElementById('confirm-modal-text').textContent = message;
    const okBtn = document.getElementById('confirm-btn-ok');
    okBtn.textContent = buttonText || t('btn_remove');
    okBtn.style.backgroundColor = buttonColor || '#e74c3c';
    pendingConfirmAction = onConfirm;
    document.getElementById('confirm-modal').classList.add('active');
}

function closeConfirmModal(confirmed) {
    document.getElementById('confirm-modal').classList.remove('active');
    if (confirmed && pendingConfirmAction) {
        pendingConfirmAction();
    }
    pendingConfirmAction = null;
}

// Toast notification
let toastTimeout = null;
function showNotificationModal(message, isSuccess) {
    const toast = document.getElementById('notification-modal');
    document.getElementById('notification-modal-text').textContent = message;
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.classList.remove('success');
    if (isSuccess) toast.classList.add('success');
    toast.classList.add('active');
    toastTimeout = setTimeout(closeNotificationModal, isSuccess ? 2000 : 3000);
}

function closeNotificationModal() {
    const toast = document.getElementById('notification-modal');
    toast.classList.remove('active');
    if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
    setTimeout(() => toast.classList.remove('success'), 300);
}

// Fullskjerm tekst-editor
let currentEditingField = null;

function openTextEditor(inputElement, label) {
    currentEditingField = inputElement;
    // Use data-full-value if available (contains multiline text), otherwise fall back to .value
    const fullValue = inputElement.getAttribute('data-full-value');
    document.getElementById('text-editor-textarea').value = fullValue !== null ? fullValue : inputElement.value;
    document.getElementById('text-editor-title').textContent = label;
    document.getElementById('text-editor-modal').classList.add('active');
    document.getElementById('text-editor-textarea').focus();
}

function closeTextEditor() {
    if (currentEditingField) {
        const fullText = document.getElementById('text-editor-textarea').value;
        currentEditingField.setAttribute('data-full-value', fullText);
        const lines = fullText.split('\n').filter(l => l.trim() !== '');
        const descBtn = currentEditingField.parentElement.querySelector('.mobile-desc-btn');

        if (lines.length === 0) {
            // Empty: show button, hide textarea
            currentEditingField.value = '';
            currentEditingField.style.display = 'none';
            if (descBtn) descBtn.style.display = '';
        } else {
            // Has content: show textarea, hide button
            const previewLines = lines.slice(0, 8);
            const preview = lines.length > 8 ? previewLines.join('\n') + '...' : previewLines.join('\n');
            currentEditingField.value = preview;
            currentEditingField.style.display = '';
            if (descBtn) descBtn.style.display = 'none';
        }
        autoResizeTextarea(currentEditingField, 4);
        currentEditingField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.getElementById('text-editor-modal').classList.remove('active');
    currentEditingField = null;
}

// Format today's date as DD.MM.YYYY
function formatDate(date) {
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    return `${d}.${m}.${y}`;
}

// Get ISO 8601 week number
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Check if mobile/tablet (≤1024px) or PC (>1024px)
function isMobile() {
    return window.innerWidth <= 1024;
}

// Auto-resize textarea to fit content (maxLines caps visible lines)
function autoResizeTextarea(textarea, maxLines) {
    textarea.style.overflow = 'hidden';
    textarea.rows = 1;
    textarea.style.height = '0';
    void textarea.offsetHeight;
    var scrollH = textarea.scrollHeight;
    var cs = getComputedStyle(textarea);
    var border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    var height = scrollH + border;
    if (maxLines) {
        var lineH = parseFloat(cs.lineHeight);
        var pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        var maxH = Math.ceil(lineH * maxLines + pad + border);
        height = Math.min(height, maxH);
    }
    var minH = textarea.classList.contains('work-material') ? 18 : 24;
    textarea.style.height = Math.max(height, minH) + 'px';
}


// Fakturaadresse: combine/parse helpers + popup
function combineFakturaadresse(gate, postnr, poststed) {
    var parts = [];
    if (gate) parts.push(gate);
    var postal = [postnr, poststed].filter(Boolean).join(' ');
    if (postal) parts.push(postal);
    return parts.join(', ');
}

function parseFakturaadresse(str) {
    if (!str) return { gate: '', postnr: '', poststed: '' };
    var lastComma = str.lastIndexOf(', ');
    if (lastComma === -1) return { gate: str, postnr: '', poststed: '' };
    var gate = str.substring(0, lastComma);
    var rest = str.substring(lastComma + 2);
    var spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return { gate: gate, postnr: '', poststed: rest };
    return {
        gate: gate,
        postnr: rest.substring(0, spaceIdx),
        poststed: rest.substring(spaceIdx + 1)
    };
}

var _fakturaadresseTarget = null;

function openFakturaadressePopup(target) {
    _fakturaadresseTarget = target;
    var currentVal = '';
    if (target === 'form') {
        currentVal = document.getElementById('mobile-fakturaadresse').value;
    } else {
        currentVal = document.getElementById('tpl-edit-fakturaadresse').value;
        document.getElementById('template-editor-overlay').classList.remove('active');
    }
    var parsed = parseFakturaadresse(currentVal);
    document.getElementById('fak-popup-gate').value = parsed.gate;
    document.getElementById('fak-popup-postnr').value = parsed.postnr;
    document.getElementById('fak-popup-poststed').value = parsed.poststed;
    document.getElementById('fakturaadresse-popup').classList.add('active');
    setTimeout(function() { document.getElementById('fak-popup-gate').focus(); }, 100);
}

function closeFakturaadressePopup() {
    document.getElementById('fakturaadresse-popup').classList.remove('active');
    if (_fakturaadresseTarget === 'template') {
        document.getElementById('template-editor-overlay').classList.add('active');
    }
    _fakturaadresseTarget = null;
}

function confirmFakturaadressePopup() {
    var gate = document.getElementById('fak-popup-gate').value.trim();
    var postnr = document.getElementById('fak-popup-postnr').value.trim();
    var poststed = document.getElementById('fak-popup-poststed').value.trim();
    var combined = combineFakturaadresse(gate, postnr, poststed);

    if (_fakturaadresseTarget === 'form') {
        document.getElementById('mobile-fakturaadresse').value = combined;
        updateFakturaadresseDisplay('fakturaadresse-display-text', combined);
    } else if (_fakturaadresseTarget === 'template') {
        document.getElementById('tpl-edit-fakturaadresse').value = combined;
        updateFakturaadresseDisplay('tpl-fakturaadresse-display-text', combined);
    }
    closeFakturaadressePopup();
}

function updateFakturaadresseDisplay(spanId, value) {
    var span = document.getElementById(spanId);
    if (!span) return;
    if (value) {
        span.textContent = value;
        span.className = 'fakturaadresse-display-text';
    } else {
        span.textContent = t('placeholder_fakturaadresse');
        span.className = 'fakturaadresse-display-placeholder';
    }
}

// Convert textareas to divs for export (divs wrap text properly)
function convertTextareasToDiv() {
    const convertedElements = [];

    // Convert ordreseddel-nr input to span (fixes rendering issues with html2canvas)
    const ordreseddelInput = document.getElementById('ordreseddel-nr');
    if (ordreseddelInput) {
        const span = document.createElement('span');
        span.textContent = ordreseddelInput.value;
        span.className = 'ordreseddel-nr-converted';
        ordreseddelInput.style.display = 'none';
        ordreseddelInput.parentNode.insertBefore(span, ordreseddelInput.nextSibling);
        convertedElements.push({ original: ordreseddelInput, replacement: span });
    }

    return convertedElements;
}

// Restore textareas after export
function restoreTextareas(convertedElements) {
    convertedElements.forEach(({ original, replacement }) => {
        original.style.display = '';
        replacement.remove();
    });
}

function copyOrderNumber() {
    const nr = document.getElementById('mobile-ordreseddel-nr').value;
    if (!nr) return;
    navigator.clipboard.writeText(nr).then(() => {
        showNotificationModal(t('copied_to_clipboard'), true);
    }).catch(() => {
        // Fallback for older browsers
        const input = document.getElementById('mobile-ordreseddel-nr');
        input.select();
        document.execCommand('copy');
        showNotificationModal(t('copied_to_clipboard'), true);
    });
}

// --- Order card functions ---
const deleteIcon = '<svg viewBox="4 2 16 20" width="24" height="24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
const copyIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';

function createOrderCard(orderData, expanded) {
    const card = document.createElement('div');
    card.className = 'mobile-order-card';

    const desc = orderData.description || '';

    card.innerHTML = `
        <div class="mobile-order-header" onclick="toggleOrder(this)">
            <span class="mobile-order-arrow">${expanded ? '&#9650;' : '&#9660;'}</span>
            <span class="mobile-order-title">${t('order_description')}</span>
            <button type="button" class="mobile-order-header-delete" onclick="event.stopPropagation(); removeOrder(this)">${deleteIcon}</button>
        </div>
        <div class="mobile-order-body" style="${expanded ? '' : 'display:none'}">
            <div class="mobile-field${((cachedRequiredSettings || getDefaultRequiredSettings()).save.beskrivelse !== false) ? ' field-required' : ''}">
                <label data-i18n="order_description">${t('order_description')}</label>
                <button type="button" class="mobile-desc-btn">+ ${t('order_description')}</button>
                <textarea class="mobile-order-desc" rows="1" readonly autocapitalize="sentences"></textarea>
            </div>
            <div class="mobile-order-materials-section">
                <label class="mobile-order-sublabel" data-i18n="order_materials_label">${t('order_materials_label')}</label>
                <div class="mobile-order-materials"></div>
                <button type="button" class="mobile-add-mat-btn" onclick="openMaterialPicker(this)">+ ${t('order_add_material')}</button>
            </div>
            <div class="mobile-work-row">
                <div class="mobile-field" style="flex:1">
                    <label data-i18n="order_hours">${t('order_hours')}</label>
                    <input type="text" class="mobile-order-timer" inputmode="decimal">
                </div>
            </div>
        </div>`;

    // Set description
    const descInput = card.querySelector('.mobile-order-desc');
    const descBtn = card.querySelector('.mobile-desc-btn');

    if (isMobile()) {
        // Mobile/tablet: use preview + fullscreen modal
        descInput.setAttribute('data-full-value', desc);
        const descLines = desc.split('\n').filter(l => l.trim());

        // Always set up click handlers for both
        descBtn.addEventListener('click', function() {
            openTextEditor(descInput, t('order_description'));
        });
        descInput.addEventListener('click', function() {
            openTextEditor(this, t('order_description'));
        });

        if (descLines.length === 0) {
            // Empty: show button, hide textarea
            descInput.style.display = 'none';
        } else {
            // Has content: show textarea, hide button
            descBtn.style.display = 'none';
            const previewLines = descLines.slice(0, 8);
            const preview = descLines.length > 8 ? previewLines.join('\n') + '...' : previewLines.join('\n');
            descInput.value = preview;
        }
    } else {
        descBtn.style.display = 'none';
        // PC: inline editable, no modal
        descInput.value = desc;
        descInput.removeAttribute('readonly');
        descInput.style.resize = 'vertical';
        descInput.style.minHeight = '80px';
    }

    // Set timer
    card.querySelector('.mobile-order-timer').value = orderData.timer || '';

    // Add materials
    const matContainer = card.querySelector('.mobile-order-materials');
    const mats = orderData.materials && orderData.materials.length > 0 ? orderData.materials : [];
    renderMaterialSummary(matContainer, mats);

    return card;
}

// Pipe sealant helpers
function getRunningMeterInfo(matName) {
    if (!matName) return null;
    var allMats = cachedMaterialOptions || [];
    for (var i = 0; i < allMats.length; i++) {
        var m = allMats[i];
        if ((m.type === 'mansjett' || m.type === 'brannpakning') && matName.toLowerCase().startsWith(m.name.toLowerCase() + ' ')) {
            var rest = matName.substring(m.name.length + 1);
            // Strip "mm" suffix before parsing
            rest = rest.replace(/mm(?=r\d+$|$)/, '');
            // Parse round "ø50" / "Ø50" / "ø50r2" or square "90x90" / "90x90r2"
            var roundMatch = rest.match(/^[øØ](\d+(?:[.,]\d+)?)(?:r(\d+))?$/);
            if (roundMatch) {
                var diameter = parseFloat(roundMatch[1].replace(',', '.'));
                var rounds = roundMatch[2] ? parseInt(roundMatch[2], 10) : 1;
                return { baseName: m.name, diameter: diameter, rounds: rounds, isSquare: false };
            }
            var squareMatch = rest.match(/^(\d+)x(\d+)(?:r(\d+))?$/);
            if (squareMatch) {
                var width = parseInt(squareMatch[1], 10);
                var height = parseInt(squareMatch[2], 10);
                var sqRounds = squareMatch[3] ? parseInt(squareMatch[3], 10) : 1;
                return { baseName: m.name, width: width, height: height, rounds: sqRounds, isSquare: true };
            }
        }
    }
    return null;
}

function calculateRunningMeters(info, quantity) {
    if (!info || !quantity || isNaN(quantity)) return 0;
    var circumference;
    if (info.isSquare) {
        circumference = 2 * (info.width + info.height);
    } else {
        circumference = Math.PI * info.diameter;
    }
    return circumference * info.rounds * quantity / 1000;
}

function formatRunningMeters(value) {
    if (!value || value === 0) return '0';
    return value.toFixed(2).replace('.', ',');
}

function createMaterialSummaryRow(m) {
    const div = document.createElement('div');
    div.className = 'mobile-material-row';
    div.setAttribute('data-mat-name', m.name || '');
    div.setAttribute('data-mat-antall', m.antall || '');
    div.setAttribute('data-mat-enhet', m.enhet || '');
    const nameDisplay = (m.name || '').replace(/^(.+?)r(\d+)$/, '$1 ($2r)');
    const nameText = escapeHtml(nameDisplay) || t('placeholder_material');
    const detailParts = [];
    const pipeInfo = getRunningMeterInfo(m.name);
    if (pipeInfo && m.antall) {
        var pipes = parseFloat((m.antall || '').replace(',', '.'));
        if (!isNaN(pipes) && pipes > 0) {
            var lm = calculateRunningMeters(pipeInfo, pipes);
            detailParts.push(escapeHtml(m.antall) + ' ' + escapeHtml(m.enhet || 'stk'));
            detailParts.push(formatRunningMeters(lm) + ' meter');
        } else {
            if (m.antall) detailParts.push(escapeHtml(m.antall));
            if (m.enhet) detailParts.push(escapeHtml(m.enhet));
        }
    } else {
        if (m.antall) detailParts.push(escapeHtml(m.antall));
        if (m.enhet) detailParts.push(escapeHtml(m.enhet));
    }
    const detail = detailParts.length > 0 ? detailParts.join(' ') : '';
    div.innerHTML = `
        <div class="mat-summary-row">
            <span class="mat-summary-name">${nameText}</span>
            ${detail ? `<span class="mat-summary-detail">${detail}</span>` : ''}
        </div>`;
    return div;
}

function renderMaterialSummary(matContainer, materials) {
    matContainer.innerHTML = '';
    materials.forEach(m => {
        if (!m.name && !m.antall && !m.enhet) return;
        // Skip spec-base materials
        if (cachedMaterialOptions) {
            var specBase = cachedMaterialOptions.find(function(o) {
                return o.name.toLowerCase() === (m.name || '').toLowerCase() && (o.type === 'mansjett' || o.type === 'brannpakning' || o.type === 'kabelhylse');
            });
            if (specBase) return;
        }
        matContainer.appendChild(createMaterialSummaryRow(m));
    });
}

function getMaterialsFromContainer(matContainer) {
    const materials = [];
    matContainer.querySelectorAll('.mobile-material-row').forEach(row => {
        const name = row.getAttribute('data-mat-name') || '';
        const antall = row.getAttribute('data-mat-antall') || '';
        const enhet = row.getAttribute('data-mat-enhet') || '';
        if (name || antall || enhet) {
            materials.push({ name, antall, enhet });
        }
    });
    return materials;
}

// Material picker overlay
let pickerOrderCard = null;
let pickerState = {}; // { "materialenavn": { checked: true, antall: "5", enhet: "stk" } }
let pickerRenderFn = null; // Reference to renderPickerList inside closure

function openMaterialPicker(btn) {
    const card = btn.closest('.mobile-order-card') || btn.closest('.service-entry-card');
    pickerOrderCard = card;
    const matContainer = card.querySelector('.mobile-order-materials');
    const existing = getMaterialsFromContainer(matContainer);

    const allMaterials = cachedMaterialOptions || [];

    const modal = document.getElementById('picker-overlay');
    const list = document.getElementById('picker-overlay-list');

    // Initialize pickerState from existing materials
    pickerState = {};
    var dupCounters = {};
    existing.forEach(m => {
        if (m.name) {
            // Skip spec-base materials (e.g. "FSC" when type is mansjett/brannpakning/kabelhylse)
            var isSpecBase = allMaterials.some(function(o) {
                return o.name.toLowerCase() === m.name.toLowerCase() && (o.type === 'mansjett' || o.type === 'brannpakning' || o.type === 'kabelhylse');
            });
            if (isSpecBase) return;
            // If this name already exists in pickerState, use __N suffix for duplicates
            if (pickerState[m.name]) {
                if (!dupCounters[m.name]) dupCounters[m.name] = 1;
                dupCounters[m.name]++;
                pickerState[m.name + '__' + dupCounters[m.name]] = { checked: true, antall: m.antall || '', enhet: m.enhet || '' };
            } else {
                pickerState[m.name] = { checked: true, antall: m.antall || '', enhet: m.enhet || '' };
            }
        }
    });

    function formatDisplayName(name) {
        // Convert "FSW ø50r2" to "FSW ø50 (2r)" for display
        var match = name.match(/^(.+ ø\d+)r(\d+)$/);
        if (match) return match[1] + ' (' + match[2] + 'r)';
        return name;
    }

    function buildRow(name, isChecked, antall, enhet, matType, displayNameOverride) {
        const displayName = displayNameOverride ? formatDisplayName(displayNameOverride) : formatDisplayName(name);
        const enhetLabel = enhet || t('placeholder_unit');
        const enhetClass = enhet ? '' : ' placeholder';
        const isLauncher = matType === 'mansjett' || matType === 'brannpakning' || matType === 'kabelhylse';
        const dupBtn = '<button type="button" class="picker-mat-dup-btn" title="Dupliser"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button>';
        const typeDot = matType === 'mansjett' ? '<span class="picker-mat-dot picker-mat-dot-mansjett"></span>'
            : matType === 'brannpakning' ? '<span class="picker-mat-dot picker-mat-dot-brannpakning"></span>'
            : matType === 'kabelhylse' ? '<span class="picker-mat-dot picker-mat-dot-kabelhylse"></span>'
            : '';
        const specBadge = typeDot;
        const lmBadge = '';
        const antallPlaceholder = t('placeholder_quantity');
        const readonlyAttr = isChecked ? '' : ' readonly';
        return `<div class="picker-mat-row${isChecked ? ' picker-mat-selected' : ''}" data-mat-name="${escapeHtml(name)}" data-mat-type="${matType || 'standard'}">
            <div class="picker-mat-check"><span class="picker-mat-name">${escapeHtml(displayName)}</span>${specBadge}${lmBadge}</div>
            <input type="text" class="picker-mat-antall" placeholder="${antallPlaceholder}" inputmode="numeric" value="${escapeHtml(antall)}"${readonlyAttr}>
            <button type="button" class="picker-mat-enhet-btn${enhetClass}" data-enhet="${escapeHtml(enhet)}">${escapeHtml(enhetLabel)}</button>${dupBtn}
        </div>`;
    }

    // Helper: find base material object for a name (checks if it's a spec-derived name)
    function findBaseMaterial(name) {
        return allMaterials.find(m => (m.type === 'mansjett' || m.type === 'brannpakning' || m.type === 'kabelhylse') && name.toLowerCase().startsWith(m.name.toLowerCase() + ' '));
    }

    function renderPickerList() {
        pickerRenderFn = renderPickerList; // Expose for unitPickerCallback
        // Build list: configured materials + checked spec-derived entries + checked custom entries
        const entries = [];

        // Add all configured materials
        allMaterials.forEach(matObj => {
            var matType = matObj.type || 'standard';
            if (matType === 'mansjett' || matType === 'brannpakning' || matType === 'kabelhylse') {
                // Spec material: show as launcher only if no derived entries exist yet
                const hasDerived = Object.keys(pickerState).some(k => k.toLowerCase().startsWith(matObj.name.toLowerCase() + ' '));
                if (!hasDerived) {
                    entries.push({ name: matObj.name, isChecked: false, antall: '', enhet: matObj.defaultUnit || '', matType: matType, isSpecDerived: false });
                }
            } else {
                const state = pickerState[matObj.name] || pickerState[Object.keys(pickerState).find(k => k.toLowerCase() === matObj.name.toLowerCase())];
                const isChecked = state && state.checked;
                const defUnit = matObj.defaultUnit || '';
                const enhet = state ? (state.enhet || defUnit) : defUnit;
                entries.push({ name: matObj.name, isChecked, antall: state ? (state.antall || '') : '', enhet: enhet, matType: 'standard', isSpecDerived: false });
            }
        });

        // Add pickerState entries that are spec-derived, duplicates, or custom
        Object.keys(pickerState).forEach(name => {
            const state = pickerState[name];
            const baseMat = findBaseMaterial(name);
            // Check for duplicate entries (e.g. "FSA__2")
            const dupMatch = name.match(/^(.+)__(\d+)$/);
            if (dupMatch) {
                const baseName = dupMatch[1];
                const baseMatObj = allMaterials.find(m => m.name === baseName);
                entries.push({ name, displayName: baseName, isChecked: state.checked, antall: state.antall || '', enhet: state.enhet || '', matType: 'standard', isSpecDerived: true });
            } else if (baseMat) {
                // Spec-derived entry (e.g. "Kabelhylse ø50x250mm")
                const defUnit = (baseMat.type === 'mansjett' || baseMat.type === 'brannpakning') ? 'stk' : (baseMat.defaultUnit || '');
                const enhet = state.enhet || defUnit;
                if (!state.enhet && defUnit) state.enhet = defUnit;
                entries.push({ name, isChecked: state.checked, antall: state.antall || '', enhet: enhet, matType: 'standard', isSpecDerived: true });
            } else if (state.checked && !allMaterials.some(m => m.name.toLowerCase() === name.toLowerCase())) {
                // Custom entry not in settings — only show when checked
                entries.push({ name, isChecked: true, antall: state.antall || '', enhet: state.enhet || '', matType: 'standard', isSpecDerived: false });
            }
        });

        // Sort alphabetically
        entries.sort((a, b) => a.name.localeCompare(b.name, 'nb'));

        let html = '';
        entries.forEach(e => {
            html += buildRow(e.name, e.isChecked, e.antall, e.enhet, e.matType, e.displayName);
        });

        if (!html) {
            html = '<div style="padding:16px;color:#999;text-align:center;">' + t('settings_no_materials') + '</div>';
        }

        list.innerHTML = html;
        attachRowListeners();
    }

    function attachRowListeners() {
        list.querySelectorAll('.picker-mat-row').forEach(row => {
            const nameDiv = row.querySelector('.picker-mat-check');
            const antallInput = row.querySelector('.picker-mat-antall');
            const enhetBtn = row.querySelector('.picker-mat-enhet-btn');
            const name = row.getAttribute('data-mat-name');
            const matType = row.getAttribute('data-mat-type') || 'standard';

            nameDiv.addEventListener('click', function() {
                if (matType === 'mansjett' || matType === 'brannpakning' || matType === 'kabelhylse') {
                    const baseMat = allMaterials.find(m => m.name === name);
                    openSpecPopup(name, function(spec) {
                        var fullName = name + ' ' + spec;
                        var defUnit = baseMat ? ((baseMat.type === 'mansjett' || baseMat.type === 'brannpakning') ? 'stk' : (baseMat.defaultUnit || '')) : '';
                        pickerState[fullName] = { checked: true, antall: '', enhet: defUnit };
                        renderPickerList();
                    }, matType);
                    return;
                }
                const isChecked = pickerState[name] && pickerState[name].checked;
                if (isChecked) {
                    pickerState[name].checked = false;
                } else {
                    pickerState[name] = pickerState[name] || { checked: false, antall: '', enhet: '' };
                    pickerState[name].checked = true;
                    pickerState[name].antall = antallInput.value;
                    pickerState[name].enhet = enhetBtn.getAttribute('data-enhet') || '';
                }
                renderPickerList();
            });

            antallInput.addEventListener('input', function() {
                // Only allow input if material is checked
                if (!pickerState[name] || !pickerState[name].checked) return;
                pickerState[name].antall = this.value;
                // Capture default enhet from button if not already set in state
                if (!pickerState[name].enhet) {
                    var btnEnhet = enhetBtn.getAttribute('data-enhet') || '';
                    if (btnEnhet) pickerState[name].enhet = btnEnhet;
                }
            });

            enhetBtn.addEventListener('click', function(e) {
                e.preventDefault();
                // Only allow unit picker if material is checked
                if (!pickerState[name] || !pickerState[name].checked) return;
                // Find allowed units for this material (handle __N keys)
                var lookupName = name.replace(/__\d+$/, '');
                var matObj = allMaterials.find(m => m.name === lookupName) || findBaseMaterial(name);
                var allowed = matObj && matObj.allowedUnits && matObj.allowedUnits.length > 0 ? matObj.allowedUnits : (matObj && matObj.defaultUnit ? [matObj.defaultUnit] : []);
                openUnitPicker(name, this, allowed);
            });

            // Duplicate button
            var dupBtn = row.querySelector('.picker-mat-dup-btn');
            if (dupBtn) {
                dupBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var baseName = name.replace(/__\d+$/, '');
                    // Check if this is a spec-derived material (has a base spec material)
                    var specBaseMat = findBaseMaterial(baseName) || findBaseMaterial(name);
                    if (!specBaseMat) {
                        // Also check if the material itself is a spec type
                        var selfMat = allMaterials.find(m => m.name === baseName);
                        if (selfMat && (selfMat.type === 'mansjett' || selfMat.type === 'brannpakning' || selfMat.type === 'kabelhylse')) {
                            specBaseMat = selfMat;
                        }
                    }
                    if (specBaseMat) {
                        // Spec material: open spec popup to add another variant
                        var specName = specBaseMat.name;
                        var specType = specBaseMat.type;
                        openSpecPopup(specName, function(spec) {
                            var fullName = specName + ' ' + spec;
                            var defUnit = (specType === 'mansjett' || specType === 'brannpakning') ? 'stk' : (specBaseMat.defaultUnit || '');
                            pickerState[fullName] = { checked: true, antall: '', enhet: defUnit };
                            renderPickerList();
                        }, specType);
                    } else {
                        // Standard material: create __N duplicate with default unit
                        var matObj = allMaterials.find(m => m.name === baseName);
                        var defUnit = matObj ? (matObj.defaultUnit || '') : '';
                        var n = 2;
                        while (pickerState[baseName + '__' + n]) n++;
                        var newKey = baseName + '__' + n;
                        pickerState[newKey] = { checked: false, antall: '', enhet: defUnit };
                        renderPickerList();
                    }
                });
            }
        });
    }

    renderPickerList();

    modal.classList.add('active');
}

function closePickerOverlay() {
    document.getElementById('picker-overlay').classList.remove('active');
    pickerOrderCard = null;
}

// Spec popup for materials that need a specification
let specPopupCallback = null;
let specPopupMatType = 'kabelhylse'; // 'mansjett' | 'brannpakning' | 'kabelhylse'

function openSpecPopup(baseName, callback, matType) {
    specPopupMatType = matType || 'kabelhylse';
    const input = document.getElementById('spec-popup-input');
    const input2 = document.getElementById('spec-popup-input2');
    const input3 = document.getElementById('spec-popup-input3');
    input.value = '';
    input2.value = '';
    input3.value = '';

    document.getElementById('spec-popup-title').textContent = baseName;

    const label1 = document.getElementById('spec-popup-label1');
    const label2 = document.getElementById('spec-popup-label2');
    const label3 = document.getElementById('spec-popup-label3');
    const field2 = document.getElementById('spec-popup-field2');
    const field3 = document.getElementById('spec-popup-field3');

    input.placeholder = '';
    label1.innerHTML = t('dim_popup_width_placeholder') + ' <span class="spec-required-star">*</span>';
    input2.placeholder = '';
    label2.textContent = t('dim_popup_height_placeholder');
    field2.style.display = '';

    if (specPopupMatType === 'mansjett') {
        field3.style.display = 'none';
    } else if (specPopupMatType === 'brannpakning') {
        field3.style.display = '';
        input3.placeholder = '';
        label3.innerHTML = t('dim_popup_rounds_placeholder') + ' <span class="spec-required-star">*</span>';
    } else {
        field3.style.display = '';
        input3.placeholder = '';
        label3.innerHTML = t('dim_popup_depth_placeholder') + ' <span class="spec-required-star">*</span>';
    }

    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input2.inputMode = 'numeric';
    input2.pattern = '[0-9]*';
    input3.inputMode = 'numeric';
    input3.pattern = '[0-9]*';

    specPopupCallback = callback;
    var keyHandler = function(e) {
        if (e.key === 'Enter') { e.preventDefault(); confirmSpecPopup(); }
        if (e.key === 'Escape') { e.preventDefault(); closeSpecPopup(); }
    };
    input.onkeydown = keyHandler;
    input2.onkeydown = keyHandler;
    input3.onkeydown = keyHandler;
    document.getElementById('spec-popup').classList.add('active');
    setTimeout(function() { input.focus(); }, 100);
}

function closeSpecPopup() {
    document.getElementById('spec-popup').classList.remove('active');
    specPopupCallback = null;
    specPopupMatType = 'kabelhylse';
}

function confirmSpecPopup() {
    const val1 = document.getElementById('spec-popup-input').value.trim();
    const val2 = document.getElementById('spec-popup-input2').value.trim();
    const val3 = document.getElementById('spec-popup-input3').value.trim();
    if (!val1) return;

    const num1 = parseInt(val1, 10);
    if (isNaN(num1) || num1 <= 0) {
        showNotificationModal(t('dim_invalid_diameter'));
        return;
    }
    var num2 = val2 ? parseInt(val2, 10) : 0;
    var num3 = val3 ? parseInt(val3, 10) : 0;
    var spec;

    if (specPopupMatType === 'mansjett') {
        // Mansjett: bredde/Ø + høyde(valgfri), ingen runder
        var isSquare = num2 > 0;
        if (isSquare) {
            spec = num1 + 'x' + num2 + 'mm';
        } else {
            spec = '\u00d8' + num1 + 'mm';
        }
    } else if (specPopupMatType === 'brannpakning') {
        // Brannpakning: bredde/Ø + høyde(valgfri) + runder(obligatorisk)
        if (!num3 || num3 <= 0) return; // Runder er obligatorisk
        var isSquare = num2 > 0;
        if (isSquare) {
            spec = num1 + 'x' + num2;
        } else {
            spec = '\u00d8' + num1;
        }
        spec += 'mm';
        if (num3 > 1) {
            spec += 'r' + num3;
        }
    } else {
        // Kabelhylse: bredde/Ø + høyde(valgfri) + dybde(obligatorisk)
        if (!num3 || num3 <= 0) return; // Dybde er obligatorisk
        if (num2 > 0) {
            spec = num1 + 'x' + num2 + 'x' + num3 + 'mm';
        } else {
            spec = '\u00d8' + num1 + 'x' + num3 + 'mm';
        }
    }
    if (specPopupCallback) specPopupCallback(spec);
    closeSpecPopup();
}

function pickerOverlayConfirm() {
    if (!pickerOrderCard) { closePickerOverlay(); return; }

    // Helper: check if name is a spec-base material (launcher) — should never be exported
    var allMats = cachedMaterialOptions || [];
    function isSpecBase(name) {
        return allMats.some(function(m) {
            return m.name === name && (m.type === 'mansjett' || m.type === 'brannpakning' || m.type === 'kabelhylse');
        });
    }



    // Validate: warn if any material has partial data (skip spec-base launchers)
    const incomplete = [];
    for (const [name, state] of Object.entries(pickerState)) {
        if (isSpecBase(name)) continue;
        const hasAntall = !!state.antall;
        const hasEnhet = !!state.enhet;
        if (state.checked && (!hasAntall || !hasEnhet)) {
            incomplete.push(name);
        } else if (!state.checked && (hasAntall !== hasEnhet)) {
            incomplete.push(name);
        }
    }
    if (incomplete.length > 0) {
        showNotificationModal(t('picker_incomplete', incomplete.join(', ')));
        return;
    }

    const materials = [];
    for (const [name, state] of Object.entries(pickerState)) {
        if (isSpecBase(name)) continue;
        if (state.checked) {
            // Strip __N suffix for duplicated entries
            const realName = name.replace(/__\d+$/, '');
            materials.push({ name: realName, antall: state.antall || '', enhet: state.enhet || '' });
        }
    }

    const matContainer = pickerOrderCard.querySelector('.mobile-order-materials');
    renderMaterialSummary(matContainer, materials);
    if (pickerOrderCard.closest('#service-entries')) {
        sessionStorage.setItem('firesafe_service_current', JSON.stringify(getServiceFormData()));
    } else {
        sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    }
    closePickerOverlay();
}

// Unit picker overlay
let unitPickerCallback = null;

function openUnitPicker(matName, btnEl, allowedUnits) {
    allowedUnits = allowedUnits || [];
    const overlay = document.getElementById('unit-picker-overlay');
    const listEl = document.getElementById('unit-picker-list');
    const currentEnhet = btnEl.getAttribute('data-enhet') || '';

    let html = '';
    allowedUnits.forEach(u => {
        const label = typeof u === 'string' ? u : u.plural;
        const isSelected = label === currentEnhet;
        const selected = isSelected ? ' unit-picker-item-selected' : '';
        html += `<button type="button" class="unit-picker-item${selected}">${escapeHtml(label)}<span class="unit-picker-item-check">${isSelected ? '✓' : ''}</span></button>`;
    });

    listEl.innerHTML = html;

    unitPickerCallback = function(value) {
        btnEl.setAttribute('data-enhet', value);
        btnEl.textContent = value || t('placeholder_unit');
        btnEl.classList.toggle('placeholder', !value);
        if (!pickerState[matName]) pickerState[matName] = { checked: false, antall: '', enhet: '' };
        pickerState[matName].enhet = value;
        // Auto-select when both antall and enhet are filled
        if (value && pickerState[matName].antall && !pickerState[matName].checked) {
            pickerState[matName].checked = true;
            if (pickerRenderFn) pickerRenderFn();
        }
    };

    // Unit item click
    listEl.querySelectorAll('.unit-picker-item').forEach(item => {
        item.addEventListener('click', function() {
            // Get only the label text, excluding the check mark span
            var label = this.childNodes[0].textContent;
            unitPickerCallback(label);
            closeUnitPicker();
        });
    });

    overlay.classList.add('active');
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function closeUnitPicker() {
    const overlay = document.getElementById('unit-picker-overlay');
    overlay.classList.remove('visible');
    setTimeout(() => {
        overlay.classList.remove('active');
        unitPickerCallback = null;
    }, 150);
}

function toggleOrder(headerEl) {
    if (event && event.target.closest('.mobile-order-header-delete')) return;
    const card = headerEl.closest('.mobile-order-card');
    const body = card.querySelector('.mobile-order-body');
    const arrow = card.querySelector('.mobile-order-arrow');
    if (body.style.display === 'none') {
        body.style.display = '';
        arrow.innerHTML = '&#9650;';
        const desc = card.querySelector('.mobile-order-desc');
        if (desc && desc.style.display !== 'none') autoResizeTextarea(desc, 4);
    } else {
        body.style.display = 'none';
        arrow.innerHTML = '&#9660;';
    }
}

function renumberOrders() {
    document.querySelectorAll('#mobile-orders .mobile-order-card').forEach((card, idx) => {
        card.querySelector('.mobile-order-title').textContent = t('order_description') + ' ' + (idx + 1);
    });
}

function addOrder() {
    const container = document.getElementById('mobile-orders');
    // Collapse existing open cards
    container.querySelectorAll('.mobile-order-card').forEach(card => {
        const body = card.querySelector('.mobile-order-body');
        if (body.style.display !== 'none') {
            body.style.display = 'none';
            card.querySelector('.mobile-order-arrow').innerHTML = '&#9660;';
        }
    });
    const card = createOrderCard({ description: '', materials: [], timer: '' }, true);
    container.appendChild(card);
    updateOrderDeleteStates();
    renumberOrders();
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function removeOrder(btn) {
    const card = btn.closest('.mobile-order-card');
    showConfirmModal(t('order_delete_confirm'), function() {
        card.remove();
        updateOrderDeleteStates();
        renumberOrders();
        sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    });
}

function updateOrderDeleteStates() {
    const cards = document.querySelectorAll('#mobile-orders .mobile-order-card');
    const deleteButtons = document.querySelectorAll('#mobile-orders .mobile-order-header-delete');
    deleteButtons.forEach(btn => { btn.disabled = cards.length <= 1; });
}

// --- Service entry card functions ---

function createServiceEntryCard(entryData, expanded) {
    var data = entryData || {};
    var card = document.createElement('div');
    card.className = 'service-entry-card';

    var srvReq = cachedRequiredSettings ? cachedRequiredSettings.service : getDefaultRequiredSettings().service;
    var datoReq = srvReq.dato !== false ? ' field-required' : '';
    var pnrReq = srvReq.prosjektnr !== false ? ' field-required' : '';
    var pnavnReq = srvReq.prosjektnavn !== false ? ' field-required' : '';
    var matReq = srvReq.materialer !== false ? ' field-required' : '';

    card.innerHTML =
        '<div class="service-entry-header" onclick="toggleServiceEntry(this)">' +
            '<span class="mobile-order-arrow">' + (expanded ? '&#9650;' : '&#9660;') + '</span>' +
            '<span class="service-entry-title">' + t('service_entry_title') + '</span>' +
            '<button type="button" class="mobile-order-header-delete" onclick="event.stopPropagation(); removeServiceEntry(this)">' + deleteIcon + '</button>' +
        '</div>' +
        '<div class="service-entry-body" style="' + (expanded ? '' : 'display:none') + '">' +
            '<div class="mobile-field' + datoReq + '"><label data-i18n="label_dato">' + t('label_dato') + '</label>' +
                '<input type="text" class="service-entry-dato" value="' + escapeHtml(data.dato || '') + '"></div>' +
            '<div class="mobile-field' + pnrReq + '"><label data-i18n="label_prosjektnr">' + t('label_prosjektnr') + '</label>' +
                '<input type="text" class="service-entry-prosjektnr" inputmode="numeric" value="' + escapeHtml(data.prosjektnr || '') + '"></div>' +
            '<div class="mobile-field' + pnavnReq + '"><label data-i18n="label_prosjektnavn">' + t('label_prosjektnavn') + '</label>' +
                '<input type="text" class="service-entry-prosjektnavn" autocapitalize="sentences" value="' + escapeHtml(data.prosjektnavn || '') + '"></div>' +
            '<div class="mobile-order-materials-section' + matReq + '">' +
                '<label class="mobile-order-sublabel" data-i18n="order_materials_label">' + t('order_materials_label') + '</label>' +
                '<div class="mobile-order-materials"></div>' +
                '<button type="button" class="mobile-add-mat-btn" onclick="openMaterialPicker(this)">+ ' + t('order_add_material') + '</button>' +
            '</div>' +
        '</div>';

    // Add materials
    var matContainer = card.querySelector('.mobile-order-materials');
    var mats = data.materials && data.materials.length > 0 ? data.materials : [];
    renderMaterialSummary(matContainer, mats);

    // Update header live when prosjektnavn changes
    card.querySelector('.service-entry-prosjektnavn').addEventListener('input', renumberServiceEntries);

    return card;
}

function addServiceEntry() {
    var container = document.getElementById('service-entries');
    container.querySelectorAll('.service-entry-card').forEach(function(card) {
        var body = card.querySelector('.service-entry-body');
        if (body.style.display !== 'none') {
            body.style.display = 'none';
            card.querySelector('.mobile-order-arrow').innerHTML = '&#9660;';
        }
    });
    var card = createServiceEntryCard({}, true);
    container.appendChild(card);
    updateServiceDeleteStates();
    renumberServiceEntries();
    sessionStorage.setItem('firesafe_service_current', JSON.stringify(getServiceFormData()));
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function removeServiceEntry(btn) {
    var card = btn.closest('.service-entry-card');
    var container = document.getElementById('service-entries');
    if (container.querySelectorAll('.service-entry-card').length <= 1) return;
    showConfirmModal(t('service_entry_delete_confirm'), function() {
        card.remove();
        updateServiceDeleteStates();
        renumberServiceEntries();
        sessionStorage.setItem('firesafe_service_current', JSON.stringify(getServiceFormData()));
    }, t('btn_remove'), '#e74c3c');
}

function toggleServiceEntry(headerEl) {
    var body = headerEl.nextElementSibling;
    var arrow = headerEl.querySelector('.mobile-order-arrow');
    if (body.style.display === 'none') {
        body.style.display = '';
        arrow.innerHTML = '&#9650;';
    } else {
        body.style.display = 'none';
        arrow.innerHTML = '&#9660;';
    }
}

function renumberServiceEntries() {
    document.querySelectorAll('#service-entries .service-entry-card').forEach(function(card, idx) {
        var nameInput = card.querySelector('.service-entry-prosjektnavn');
        var title = nameInput && nameInput.value.trim()
            ? nameInput.value.trim()
            : t('service_entry_title') + ' ' + (idx + 1);
        card.querySelector('.service-entry-title').textContent = title;
    });
}

function updateServiceDeleteStates() {
    var cards = document.querySelectorAll('#service-entries .service-entry-card');
    var delBtns = document.querySelectorAll('#service-entries .mobile-order-header-delete');
    delBtns.forEach(function(btn) { btn.disabled = cards.length <= 1; });
}

function getServiceFormData() {
    var entries = [];
    document.querySelectorAll('#service-entries .service-entry-card').forEach(function(card) {
        var matContainer = card.querySelector('.mobile-order-materials');
        var mats = matContainer ? getMaterialsFromContainer(matContainer) : [];
        entries.push({
            dato: card.querySelector('.service-entry-dato').value,
            prosjektnr: card.querySelector('.service-entry-prosjektnr').value,
            prosjektnavn: card.querySelector('.service-entry-prosjektnavn').value,
            materials: mats
        });
    });
    return {
        type: 'service',
        montor: document.getElementById('service-montor').value,
        signaturePaths: window._serviceSignaturePaths || [],
        canvasAspectRatio: canvasAspectRatio,
        signatureImage: document.getElementById('service-signatur').value,
        entries: entries,
        savedAt: new Date().toISOString()
    };
}

function setServiceFormData(data) {
    if (!data) return;
    var montorEl = document.getElementById('service-montor');
    if (montorEl) montorEl.value = data.montor || '';

    // Restore signature
    window._serviceSignaturePaths = data.signaturePaths || [];
    var sigInput = document.getElementById('service-signatur');
    if (sigInput) sigInput.value = data.signatureImage || '';
    var srvPreviewImg = document.getElementById('service-signature-preview-img');
    var srvPlaceholder = document.querySelector('#service-signature-preview .signature-placeholder');
    if (data.signatureImage && data.signatureImage.startsWith('data:image')) {
        if (srvPreviewImg) { srvPreviewImg.src = data.signatureImage; srvPreviewImg.style.display = 'block'; }
        if (srvPlaceholder) srvPlaceholder.style.display = 'none';
    } else {
        if (srvPreviewImg) { srvPreviewImg.style.display = 'none'; srvPreviewImg.src = ''; }
        if (srvPlaceholder) srvPlaceholder.style.display = '';
    }

    // Render entries
    var container = document.getElementById('service-entries');
    container.innerHTML = '';
    var list = data.entries && data.entries.length > 0 ? data.entries : [{}];
    list.forEach(function(entry, idx) {
        container.appendChild(createServiceEntryCard(entry, list.length === 1));
    });
    renumberServiceEntries();
    updateServiceDeleteStates();
}

// Firebase helpers for service forms
async function getServiceForms(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('serviceforms')
                .orderBy('savedAt', 'desc').limit(50);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return {
                forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }),
                lastDoc: snapshot.docs[snapshot.docs.length - 1] || null
            };
        } catch(e) { console.error('getServiceForms error:', e); }
    }
    return { forms: safeParseJSON(SERVICE_STORAGE_KEY, []), lastDoc: null };
}

async function getServiceSentForms(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('serviceArchive')
                .orderBy('savedAt', 'desc').limit(50);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return {
                forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }),
                lastDoc: snapshot.docs[snapshot.docs.length - 1] || null
            };
        } catch(e) { console.error('getServiceSentForms error:', e); }
    }
    return { forms: safeParseJSON(SERVICE_ARCHIVE_KEY, []), lastDoc: null };
}

// Get all orders data from mobile form
function getOrdersData() {
    const orders = [];
    document.querySelectorAll('#mobile-orders .mobile-order-card').forEach(card => {
        const descInput = card.querySelector('.mobile-order-desc');
        const description = descInput.getAttribute('data-full-value') || descInput.value;
        const timer = card.querySelector('.mobile-order-timer').value;
        const matContainer = card.querySelector('.mobile-order-materials');
        const materials = getMaterialsFromContainer(matContainer);
        orders.push({ description, materials, timer });
    });
    return orders;
}

// Sync mobile form to original (desktop) form for export
function syncMobileToOriginal() {
    // Simple fields
    const fieldMap = {
        'mobile-ordreseddel-nr': 'ordreseddel-nr',
        'mobile-oppdragsgiver': 'oppdragsgiver',
        'mobile-kundens-ref': 'kundens-ref',
        'mobile-fakturaadresse': 'fakturaadresse',
        'mobile-dato': 'dato',
        'mobile-prosjektnr': 'prosjektnr',
        'mobile-prosjektnavn': 'prosjektnavn',
        'mobile-montor': 'montor',
        'mobile-avdeling': 'avdeling',
        'mobile-sted': 'sted',
        'mobile-signering-dato': 'signering-dato',
        'mobile-kundens-underskrift': 'kundens-underskrift'
    };

    for (const [mobileId, originalId] of Object.entries(fieldMap)) {
        const mobileEl = document.getElementById(mobileId);
        const originalEl = document.getElementById(originalId);
        if (mobileEl && originalEl) {
            originalEl.value = mobileEl.value;
        }
    }

    // Update desktop signature image for export
    const signatureData = document.getElementById('mobile-kundens-underskrift').value;
    const desktopSigImg = document.getElementById('desktop-signature-img');
    if (desktopSigImg) {
        if (signatureData && signatureData.startsWith('data:image')) {
            desktopSigImg.src = signatureData;
            desktopSigImg.style.display = 'block';
        } else {
            desktopSigImg.style.display = 'none';
        }
    }

    // Build desktop work lines dynamically
    buildDesktopWorkLines();
}

// ============================================
// SIGNATURE (SVG-based for perfect scaling)
// ============================================

var signatureTarget = 'form'; // 'form' or 'service'
let signatureCanvas = null;
let signatureCtx = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let signaturePaths = []; // Store paths for SVG generation
let signaturePathsBackup = []; // Backup for cancel functionality
let currentPath = [];
let canvasAspectRatio = 4; // width/height ratio, default 4:1
const signatureRatio = 3;

let signatureOrientationLocked = false;

// Lock to portrait on app start (PWA standalone)
if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('portrait-primary').catch(function() {});
}

function handleSignatureOrientationChange() {
    setTimeout(updateSignatureLayout, 200);
}

function updateSignatureLayout() {
    var overlay = document.getElementById('signature-overlay');
    if (!overlay.classList.contains('active') || signatureOrientationLocked) return;

    if (window.innerWidth < 800 && window.innerHeight > window.innerWidth) {
        // Portrait on mobile/tablet: CSS rotation to landscape
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
        overlay.style.width = window.innerHeight + 'px';
        overlay.style.height = window.innerWidth + 'px';
        overlay.style.transformOrigin = '0 0';
        overlay.style.transform = 'rotate(90deg) translateY(-100%)';
    } else {
        // Landscape: clear inline styles, let CSS position:fixed inset:0 fill screen
        overlay.style.right = '';
        overlay.style.bottom = '';
        overlay.style.width = '';
        overlay.style.height = '';
        overlay.style.transform = '';
        overlay.style.transformOrigin = '';
    }

    initSignatureCanvas();
    redrawSignature();
}

async function openSignatureOverlay() {
    const overlay = document.getElementById('signature-overlay');

    // Try to force landscape (works in installed PWA without fullscreen)
    signatureOrientationLocked = false;
    if (screen.orientation && screen.orientation.lock) {
        try {
            await screen.orientation.lock('landscape-primary');
            signatureOrientationLocked = true;
        } catch(e) {}
    }

    overlay.classList.add('active');

    if (!signatureOrientationLocked) {
        updateSignatureLayout();
        window.addEventListener('resize', updateSignatureLayout);
        window.addEventListener('orientationchange', handleSignatureOrientationChange);
    }
    currentPath = [];
    if (signatureTarget === 'service') {
        signaturePaths = window._serviceSignaturePaths || [];
        signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
        window._signatureImageBackup = document.getElementById('service-signatur').value || '';
    } else {
        signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
        window._signatureImageBackup = document.getElementById('mobile-kundens-underskrift').value || '';
    }
    window._canvasAspectRatioBackup = canvasAspectRatio;

    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            initSignatureCanvas();
            redrawSignature();

            // Fallback: if no stroke data but signature image exists (old saved forms),
            // draw the existing image onto the canvas
            if (signaturePaths.length === 0) {
                var sigData = signatureTarget === 'service'
                    ? document.getElementById('service-signatur').value
                    : document.getElementById('mobile-kundens-underskrift').value;
                if (sigData && sigData.startsWith('data:image')) {
                    var img = new Image();
                    img.onload = function() {
                        var cw = signatureCanvas.clientWidth;
                        var ch = signatureCanvas.clientHeight;
                        var scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight) * 0.8;
                        var iw = img.naturalWidth * scale;
                        var ih = img.naturalHeight * scale;
                        signatureCtx.drawImage(img, (cw - iw) / 2, (ch - ih) / 2, iw, ih);
                    };
                    img.src = sigData;
                }
            }
        });
    });
}

function cleanupSignatureOverlay() {
    window.removeEventListener('resize', updateSignatureLayout);
    window.removeEventListener('orientationchange', handleSignatureOrientationChange);

    var overlay = document.getElementById('signature-overlay');
    overlay.classList.remove('active');
    overlay.style.width = '';
    overlay.style.height = '';
    overlay.style.right = '';
    overlay.style.bottom = '';
    overlay.style.transform = '';
    overlay.style.transformOrigin = '';

    if (signatureOrientationLocked) {
        signatureOrientationLocked = false;
        // Lock back to portrait instead of just unlocking
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('portrait-primary').catch(function() {});
        }
    }
}

function closeSignatureOverlay() {
    signaturePaths = signaturePathsBackup;
    canvasAspectRatio = window._canvasAspectRatioBackup || canvasAspectRatio;
    // Restore image values in case Nullstill cleared them
    if (signatureTarget === 'service') {
        if (window._signatureImageBackup !== undefined) {
            document.getElementById('service-signatur').value = window._signatureImageBackup;
        }
        window._serviceSignaturePaths = JSON.parse(JSON.stringify(signaturePathsBackup));
    } else {
        if (window._signatureImageBackup !== undefined) {
            document.getElementById('mobile-kundens-underskrift').value = window._signatureImageBackup;
            document.getElementById('kundens-underskrift').value = window._signatureImageBackup;
        }
        // Re-snapshot so unsaved-changes detection stays accurate
        if (typeof lastSavedData !== 'undefined' && lastSavedData !== null) {
            lastSavedData = getFormDataSnapshot();
        }
    }
    cleanupSignatureOverlay();
    signatureTarget = 'form';

    // Clear preview flags (preview is still open, no action needed)
    window._signedFromPreview = false;
    window._signedFromServicePreview = false;
}

function redrawSignature() {
    if (!signatureCanvas || !signatureCtx || signaturePaths.length === 0) return;
    const w = signatureCanvas.clientWidth;
    const h = signatureCanvas.clientHeight;

    signatureCtx.lineCap = 'round';
    signatureCtx.lineJoin = 'round';
    signatureCtx.lineWidth = 4;
    signatureCtx.strokeStyle = '#000';

    for (const path of signaturePaths) {
        if (path.length < 2) continue;
        signatureCtx.beginPath();
        signatureCtx.moveTo(path[0].x * w, path[0].y * h);
        for (var i = 1; i < path.length - 1; i++) {
            var midX = (path[i].x * w + path[i+1].x * w) / 2;
            var midY = (path[i].y * h + path[i+1].y * h) / 2;
            signatureCtx.quadraticCurveTo(path[i].x * w, path[i].y * h, midX, midY);
        }
        signatureCtx.lineTo(path[path.length-1].x * w, path[path.length-1].y * h);
        signatureCtx.stroke();
    }
}

function initSignatureCanvas() {
    signatureCanvas = document.getElementById('signature-canvas');
    signatureCtx = signatureCanvas.getContext('2d');

    const w = signatureCanvas.clientWidth;
    const h = signatureCanvas.clientHeight;
    signatureCanvas.width = w * signatureRatio;
    signatureCanvas.height = h * signatureRatio;
    signatureCtx.scale(signatureRatio, signatureRatio);

    // Store aspect ratio for correct SVG generation
    canvasAspectRatio = w / h;

    signatureCtx.lineCap = 'round';
    signatureCtx.lineJoin = 'round';
    signatureCtx.lineWidth = 4;
    signatureCtx.strokeStyle = '#000';

    // Clear canvas
    signatureCtx.fillStyle = '#fff';
    signatureCtx.fillRect(0, 0, w, h);

    // Pointer events (unified mouse + touch, CSS transform-aware via offsetX/offsetY)
    signatureCanvas.onpointerdown = handlePointerDown;
    signatureCanvas.onpointermove = handlePointerMove;
    signatureCanvas.onpointerup = handlePointerUp;
    signatureCanvas.onpointercancel = handlePointerUp;
}

function getCanvasCoords(e) {
    // offsetX/offsetY are in the element's local coordinate space,
    // automatically accounting for CSS transforms like rotate(90deg)
    return {
        x: e.offsetX / signatureCanvas.clientWidth,
        y: e.offsetY / signatureCanvas.clientHeight
    };
}

function handlePointerDown(e) {
    e.preventDefault();
    signatureCanvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    const coords = getCanvasCoords(e);
    lastX = coords.x;
    lastY = coords.y;
    currentPath = [{x: coords.x, y: coords.y}];
}

function handlePointerMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const coords = getCanvasCoords(e);
    const w = signatureCanvas.clientWidth;
    const h = signatureCanvas.clientHeight;

    signatureCtx.beginPath();
    signatureCtx.moveTo(lastX * w, lastY * h);
    signatureCtx.lineTo(coords.x * w, coords.y * h);
    signatureCtx.stroke();

    currentPath.push({x: coords.x, y: coords.y});
    lastX = coords.x;
    lastY = coords.y;
}

function handlePointerUp() {
    if (isDrawing && currentPath.length > 1) {
        signaturePaths.push([...currentPath]);
    }
    isDrawing = false;
    currentPath = [];
}

function clearSignatureCanvas() {
    if (signatureCanvas && signatureCtx) {
        signatureCtx.fillStyle = '#fff';
        signatureCtx.fillRect(0, 0, signatureCanvas.clientWidth, signatureCanvas.clientHeight);
        signaturePaths = [];
        currentPath = [];
        // Also clear existing image so OK after Nullstill actually removes signature
        document.getElementById('mobile-kundens-underskrift').value = '';
        document.getElementById('kundens-underskrift').value = '';
    }
}

function generateSVG(targetHeight, strokeWidth) {
    if (signaturePaths.length === 0) return null;

    // Calculate bounding box of signature (in normalized 0-1 coords)
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const path of signaturePaths) {
        for (const point of path) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
    }

    // Add padding (5% of signature size)
    const padX = (maxX - minX) * 0.05;
    const padY = (maxY - minY) * 0.05;
    minX = Math.max(0, minX - padX);
    maxX = Math.min(1, maxX + padX);
    minY = Math.max(0, minY - padY);
    maxY = Math.min(1, maxY + padY);

    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;

    if (boxWidth <= 0 || boxHeight <= 0) return null;

    // Calculate output dimensions (maintaining signature aspect ratio, accounting for canvas shape)
    const sigAspect = (boxWidth / boxHeight) * (canvasAspectRatio || 1);
    const outputHeight = targetHeight;
    const outputWidth = Math.round(outputHeight * sigAspect);

    // Build path data with quadratic bezier curves for smooth lines
    let pathData = '';
    for (const path of signaturePaths) {
        if (path.length < 2) continue;
        var sx = ((path[0].x - minX) / boxWidth) * outputWidth;
        var sy = ((path[0].y - minY) / boxHeight) * outputHeight;
        pathData += 'M ' + sx.toFixed(2) + ' ' + sy.toFixed(2) + ' ';
        for (var i = 1; i < path.length - 1; i++) {
            var cx = ((path[i].x - minX) / boxWidth) * outputWidth;
            var cy = ((path[i].y - minY) / boxHeight) * outputHeight;
            var mx = ((path[i].x + path[i+1].x) / 2 - minX) / boxWidth * outputWidth;
            var my = ((path[i].y + path[i+1].y) / 2 - minY) / boxHeight * outputHeight;
            pathData += 'Q ' + cx.toFixed(2) + ' ' + cy.toFixed(2) + ' ' + mx.toFixed(2) + ' ' + my.toFixed(2) + ' ';
        }
        var lx = ((path[path.length-1].x - minX) / boxWidth) * outputWidth;
        var ly = ((path[path.length-1].y - minY) / boxHeight) * outputHeight;
        pathData += 'L ' + lx.toFixed(2) + ' ' + ly.toFixed(2) + ' ';
    }

    if (!pathData) return null;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${outputWidth} ${outputHeight}">
        <path d="${pathData}" fill="none" stroke="#000" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    return 'data:image/svg+xml;base64,' + btoa(svg);
}

function confirmSignature() {
    const hasSignature = signaturePaths.length > 0;

    if (signatureTarget === 'service') {
        var hasExistingServiceImage = !!document.getElementById('service-signatur').value;
        if (!hasSignature && !hasExistingServiceImage) {
            document.getElementById('service-signatur').value = '';
        } else if (!hasSignature && hasExistingServiceImage) {
            // keep as-is
        } else {
            var svgData = generateSVG(400, 18);
            if (svgData) {
                document.getElementById('service-signatur').value = svgData;
            }
        }
        window._serviceSignaturePaths = JSON.parse(JSON.stringify(signaturePaths));
        signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
        cleanupSignatureOverlay();
        signatureTarget = 'form';

        // Update service signature preview in form
        var srvSigData = document.getElementById('service-signatur').value;
        var srvPreviewImg = document.getElementById('service-signature-preview-img');
        var srvPlaceholder = document.querySelector('#service-signature-preview .signature-placeholder');
        if (srvPreviewImg && srvSigData && srvSigData.startsWith('data:image')) {
            srvPreviewImg.src = srvSigData;
            srvPreviewImg.style.display = 'block';
            if (srvPlaceholder) srvPlaceholder.style.display = 'none';
        } else if (srvPreviewImg) {
            srvPreviewImg.style.display = 'none';
            srvPreviewImg.src = '';
            if (srvPlaceholder) srvPlaceholder.style.display = '';
        }

        // Update service export table signature if preview is open
        if (window._signedFromServicePreview) {
            window._signedFromServicePreview = false;
            var sigData = document.getElementById('service-signatur').value;
            var exportSigImg = document.getElementById('service-export-sig-img');
            if (exportSigImg) {
                if (sigData && sigData.startsWith('data:image')) {
                    exportSigImg.src = sigData;
                    exportSigImg.style.display = '';
                } else {
                    exportSigImg.style.display = 'none';
                }
            }
            updatePreviewHeaderState(hasSignature);
        }
        return;
    }

    const hasExistingImage = !!document.getElementById('mobile-kundens-underskrift').value;

    if (!hasSignature && !hasExistingImage) {
        // No new drawing and no existing signature — clear
        document.getElementById('mobile-kundens-underskrift').value = '';
        document.getElementById('kundens-underskrift').value = '';
        document.getElementById('signature-preview-img').style.display = 'none';
        document.querySelector('#mobile-signature-preview .signature-placeholder').style.display = '';
    } else if (!hasSignature && hasExistingImage) {
        // No new drawing but existing signature — keep it as-is
    } else {
        // Generate SVG cropped to signature bounding box (high resolution, bold stroke)
        const svgData = generateSVG(400, 18);

        if (svgData) {
            document.getElementById('mobile-kundens-underskrift').value = svgData;
            document.getElementById('kundens-underskrift').value = svgData;
            const previewImg = document.getElementById('signature-preview-img');
            previewImg.src = svgData;
            previewImg.style.display = 'block';
            document.querySelector('#mobile-signature-preview .signature-placeholder').style.display = 'none';
        }
    }

    // Update backup to current paths (user confirmed, so keep changes)
    signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
    cleanupSignatureOverlay();

    // Update desktop signature directly in preview (preview stays open)
    if (window._signedFromPreview) {
        window._signedFromPreview = false;
        var sigData = document.getElementById('mobile-kundens-underskrift').value;
        var desktopImg = document.getElementById('desktop-signature-img');
        if (desktopImg) {
            if (sigData && sigData.startsWith('data:image')) {
                desktopImg.src = sigData;
                desktopImg.style.display = 'block';
            } else {
                desktopImg.style.display = 'none';
            }
        }
        // Update preview header to show "Ferdig" + "Signert"
        updatePreviewHeaderState(hasSignature);
    }
}

function clearSignaturePreview() {
    document.getElementById('mobile-kundens-underskrift').value = '';
    const previewImg = document.getElementById('signature-preview-img');
    if (previewImg) {
        previewImg.style.display = 'none';
        previewImg.src = '';
    }
    const placeholder = document.querySelector('#mobile-signature-preview .signature-placeholder');
    if (placeholder) placeholder.style.display = '';

    const desktopInput = document.getElementById('kundens-underskrift');
    if (desktopInput) desktopInput.value = '';

    signaturePaths = [];
    signaturePathsBackup = [];
}

function loadSignaturePreview(dataUrl) {
    if (dataUrl) {
        document.getElementById('mobile-kundens-underskrift').value = dataUrl;
        const previewImg = document.getElementById('signature-preview-img');
        if (previewImg) {
            previewImg.src = dataUrl;
            previewImg.style.display = 'block';
        }
        const placeholder = document.querySelector('#mobile-signature-preview .signature-placeholder');
        if (placeholder) placeholder.style.display = 'none';
    }
}

// Build the desktop form work lines from orders data (for PDF export)
function buildDesktopWorkLines() {
    const container = document.getElementById('work-lines');
    container.innerHTML = '';

    const orders = getOrdersData();

    function addRow(descText, antallText, enhetText, options) {
        const row = document.createElement('div');
        row.className = 'work-line';
        const descDiv = document.createElement('div');
        descDiv.className = 'work-line-desc';
        const descContent = document.createElement('div');
        descContent.className = 'work-line-desc-text';
        descContent.textContent = descText || '';
        if (options && options.bold) descContent.style.fontWeight = 'bold';
        if (options && options.italic) descContent.style.fontStyle = 'italic';
        if (options && options.alignRight) {
            descContent.style.textAlign = 'right';
            descContent.style.paddingRight = '20px';
        }
        descDiv.appendChild(descContent);
        row.appendChild(descDiv);

        const antallDiv = document.createElement('div');
        antallDiv.className = 'work-line-antall';
        const antallSpan = document.createElement('span');
        antallSpan.textContent = antallText || '';
        antallDiv.appendChild(antallSpan);
        row.appendChild(antallDiv);

        const enhetDiv = document.createElement('div');
        enhetDiv.className = 'work-line-enhet';
        const enhetSpan = document.createElement('span');
        enhetSpan.textContent = enhetText || '';
        enhetDiv.appendChild(enhetSpan);
        row.appendChild(enhetDiv);

        container.appendChild(row);
    }

    let totalTimer = 0;

    orders.forEach((order, idx) => {
        // Description
        if (order.description) {
            addRow(order.description, '', '');
        }

        // Materials
        const filledMats = (order.materials || []).filter(m => {
            if (!m.name && !m.antall && !m.enhet) return false;
            // Skip spec-base materials that shouldn't be exported
            if (cachedMaterialOptions) {
                var specBase = cachedMaterialOptions.find(function(o) {
                    return o.name.toLowerCase() === (m.name || '').toLowerCase() && (o.type === 'mansjett' || o.type === 'brannpakning' || o.type === 'kabelhylse');
                });
                if (specBase) return false;
            }
            return true;
        });
        if (filledMats.length > 0) {
            addRow('Materiell:', '', '', { bold: true, alignRight: true });
            filledMats.forEach(m => {
                const rawName = m.name ? m.name.charAt(0).toUpperCase() + m.name.slice(1) : '';
                // Format "FSW ø50r2" → "FSW ø50 (2r)" or "FSW 90x90r2" → "FSW 90x90 (2r)"
                const capName = rawName.replace(/^(.+?)r(\d+)$/, '$1 ($2r)');
                const antallNum = parseFloat((m.antall || '').replace(',', '.'));

                // Check if pipe sealant material
                const pipeInfo = getRunningMeterInfo(m.name);
                if (pipeInfo && !isNaN(antallNum) && antallNum > 0) {
                    var lm = calculateRunningMeters(pipeInfo, antallNum);
                    var displayName = capName + ' (' + (m.antall || '').replace('.', ',') + ' ' + (m.enhet || 'stk') + ')';
                    addRow(displayName, formatRunningMeters(lm), 'meter', { alignRight: true });
                } else {
                    // Singular/plural lookup from material's allowedUnits
                    var unitText = (m.enhet || '').toLowerCase();
                    if (cachedMaterialOptions && m.enhet) {
                        var matConfig = cachedMaterialOptions.find(function(cm) { return cm.name.toLowerCase() === m.name.toLowerCase(); });
                        if (!matConfig) {
                            // Try base material for spec-derived names
                            matConfig = cachedMaterialOptions.find(function(cm) { return (cm.type === 'mansjett' || cm.type === 'brannpakning' || cm.type === 'kabelhylse') && m.name.toLowerCase().startsWith(cm.name.toLowerCase() + ' '); });
                        }
                        if (matConfig && matConfig.allowedUnits) {
                            var unitObj = matConfig.allowedUnits.find(function(u) { return typeof u === 'object' && u.plural && u.plural.toLowerCase() === m.enhet.toLowerCase(); });
                            if (unitObj) {
                                unitText = (antallNum === 1 ? unitObj.singular : unitObj.plural).toLowerCase();
                            }
                        }
                    }
                    addRow(capName, (m.antall || '').replace('.', ','), unitText, { alignRight: true });
                }
            });
        }

        // Timer
        if (order.timer) {
            addRow('Tid:', (order.timer || '').replace('.', ','), 'timer', { alignRight: true });
            const val = parseFloat((order.timer || '').replace(',', '.'));
            if (!isNaN(val)) totalTimer += val;
        }
    });

    // Total timer (only if there are any)
    if (totalTimer > 0) {
        const formatted = totalTimer % 1 === 0 ? totalTimer.toString() : totalTimer.toFixed(1).replace('.', ',');
        addRow('Totalt:', formatted, 'timer', { bold: true, alignRight: true });
    }

    // Ensure minimum rows to fill the page
    const currentRows = container.querySelectorAll('.work-line').length;
    for (let i = currentRows; i < 15; i++) {
        addRow('', '', '');
    }
}

// Sync original form to mobile form (not used in new structure, kept for compatibility)
function syncOriginalToMobile() {
    const fieldMap = {
        'ordreseddel-nr': 'mobile-ordreseddel-nr',
        'oppdragsgiver': 'mobile-oppdragsgiver',
        'kundens-ref': 'mobile-kundens-ref',
        'fakturaadresse': 'mobile-fakturaadresse',
        'dato': 'mobile-dato',
        'prosjektnr': 'mobile-prosjektnr',
        'prosjektnavn': 'mobile-prosjektnavn',
        'montor': 'mobile-montor',
        'avdeling': 'mobile-avdeling',
        'sted': 'mobile-sted',
        'signering-dato': 'mobile-signering-dato',
        'kundens-underskrift': 'mobile-kundens-underskrift'
    };

    for (const [originalId, mobileId] of Object.entries(fieldMap)) {
        const originalEl = document.getElementById(originalId);
        const mobileEl = document.getElementById(mobileId);
        if (originalEl && mobileEl) {
            mobileEl.value = originalEl.value;
        }
    }

    // Load or clear signature preview
    const signatureData = document.getElementById('mobile-kundens-underskrift').value;
    if (signatureData && signatureData.startsWith('data:image')) {
        loadSignaturePreview(signatureData);
    } else {
        clearSignaturePreview();
    }

}



function getFormData() {
    if (isMobile()) {
        syncMobileToOriginal();
    }

    return {
        ordreseddelNr: document.getElementById('ordreseddel-nr').value,
        oppdragsgiver: document.getElementById('oppdragsgiver').value,
        kundensRef: document.getElementById('kundens-ref').value,
        fakturaadresse: document.getElementById('fakturaadresse').value,
        dato: document.getElementById('dato').value,
        prosjektnr: document.getElementById('prosjektnr').value,
        prosjektnavn: document.getElementById('prosjektnavn').value,
        montor: document.getElementById('montor').value,
        avdeling: document.getElementById('avdeling').value,
        orders: getOrdersData(),
        sted: document.getElementById('sted').value,
        signeringDato: document.getElementById('signering-dato').value,
        kundensUnderskrift: document.getElementById('kundens-underskrift').value,
        signaturePaths: signaturePaths,
        canvasAspectRatio: canvasAspectRatio || null,
        savedAt: new Date().toISOString()
    };
}

function setFormData(data) {
    // Helper for safe value setting
    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    }

    // Set simple fields
    setVal('ordreseddel-nr', data.ordreseddelNr);
    setVal('oppdragsgiver', data.oppdragsgiver);
    setVal('kundens-ref', data.kundensRef);
    setVal('fakturaadresse', data.fakturaadresse);
    setVal('dato', data.dato);
    setVal('prosjektnr', data.prosjektnr);
    setVal('prosjektnavn', data.prosjektnavn);
    setVal('montor', data.montor);
    setVal('avdeling', data.avdeling);
    setVal('sted', data.sted);
    setVal('signering-dato', data.signeringDato);
    setVal('kundens-underskrift', data.kundensUnderskrift);

    // Restore signature stroke data (for re-editing)
    signaturePaths = data.signaturePaths || [];
    signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
    if (data.canvasAspectRatio) canvasAspectRatio = data.canvasAspectRatio;

    syncOriginalToMobile();
    updateFakturaadresseDisplay('fakturaadresse-display-text', data.fakturaadresse || '');

    // Convert old formats to orders
    let orders = data.orders;

    if (!orders) {
        if (data.workDescription || data.materials || data.timers) {
            // Previous flat format → 1 order
            orders = [{
                description: data.workDescription || '',
                materials: data.materials || [],
                timer: (data.timers && data.timers[0]) || ''
            }];
        } else if (data.workLines) {
            // Oldest workLines format → 1 order
            const descriptions = [];
            const materials = [];
            data.workLines.forEach(wl => {
                if (wl.description) descriptions.push(wl.description);
                if (wl.material || wl.antall || wl.enhet) {
                    materials.push({ name: wl.material || '', antall: wl.antall || '', enhet: wl.enhet || '' });
                }
            });
            orders = [{
                description: descriptions.join('\n'),
                materials: materials,
                timer: ''
            }];
        }
    }

    // Render order cards
    const container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    const ordersList = orders && orders.length > 0 ? orders : [{ description: '', materials: [], timer: '' }];
    ordersList.forEach((order, idx) => {
        const expanded = ordersList.length === 1;
        const card = createOrderCard(order, expanded);
        container.appendChild(card);
    });
    container.querySelectorAll('.mobile-order-desc').forEach(ta => {
        if (ta.offsetHeight > 0) autoResizeTextarea(ta, 4);
    });
    // Re-measure after browser has completed first paint (fixes initial load timing)
    requestAnimationFrame(function() {
        container.querySelectorAll('.mobile-order-desc').forEach(ta => {
            if (ta.offsetHeight > 0) autoResizeTextarea(ta, 4);
        });
    });
    renumberOrders();
    updateOrderDeleteStates();
}

// Validering av påkrevde felter (konfigurerbar via innstillinger)
function validateRequiredFields() {
    const settings = cachedRequiredSettings || getDefaultRequiredSettings();
    const saveReqs = settings.save || {};

    const fieldMap = {
        ordreseddelNr:  { id: 'mobile-ordreseddel-nr', key: 'validation_ordreseddel_nr' },
        dato:           { id: 'mobile-dato',           key: 'validation_dato' },
        oppdragsgiver:  { id: 'mobile-oppdragsgiver',  key: 'validation_oppdragsgiver' },
        kundensRef:     { id: 'mobile-kundens-ref',    key: 'validation_kundens_ref' },
        fakturaadresse: { id: 'mobile-fakturaadresse',  key: 'validation_fakturaadresse' },
        prosjektnr:     { id: 'mobile-prosjektnr',     key: 'validation_prosjektnr' },
        prosjektnavn:   { id: 'mobile-prosjektnavn',   key: 'validation_prosjektnavn' },
        montor:         { id: 'mobile-montor',          key: 'validation_montor' },
        avdeling:       { id: 'mobile-avdeling',        key: 'validation_avdeling' },
        sted:           { id: 'mobile-sted',            key: 'validation_sted' },
        signeringDato:  { id: 'mobile-signering-dato',  key: 'validation_signering_dato' }
    };

    for (const [settingKey, fieldInfo] of Object.entries(fieldMap)) {
        if (!saveReqs[settingKey]) continue;
        const el = document.getElementById(fieldInfo.id);
        if (!el || !el.value.trim()) {
            showNotificationModal(t('required_field', t(fieldInfo.key)));
            return false;
        }
    }

    // Validate orders (beskrivelse)
    if (saveReqs.beskrivelse !== false) {
        const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
        if (orderCards.length === 0) {
            showNotificationModal(t('required_order'));
            return false;
        }
        for (let i = 0; i < orderCards.length; i++) {
            const descInput = orderCards[i].querySelector('.mobile-order-desc');
            const descVal = descInput.getAttribute('data-full-value') || descInput.value;
            if (!descVal.trim()) {
                showNotificationModal(t('required_description', i + 1));
                return false;
            }
        }
    }

    // Validate signature
    if (saveReqs.signatur) {
        const sigVal = document.getElementById('mobile-kundens-underskrift').value;
        if (!sigVal || !sigVal.trim()) {
            showNotificationModal(t('required_field', t('validation_signatur')));
            return false;
        }
    }

    return true;
}

function validateServiceRequiredFields() {
    var req = cachedRequiredSettings ? cachedRequiredSettings.service : getDefaultRequiredSettings().service;

    // Montør
    if (req.montor !== false) {
        var montor = document.getElementById('service-montor');
        if (!montor || !montor.value.trim()) {
            showNotificationModal(t('required_field', t('validation_montor')));
            return false;
        }
    }

    // Each entry card fields
    var cards = document.querySelectorAll('#service-entries .service-entry-card');
    for (var i = 0; i < cards.length; i++) {
        if (req.dato !== false) {
            var dato = cards[i].querySelector('.service-entry-dato');
            if (!dato || !dato.value.trim()) {
                showNotificationModal(t('required_field', t('label_dato')) + ' (' + t('service_entry_title') + ' ' + (i + 1) + ')');
                return false;
            }
        }
        if (req.prosjektnr !== false) {
            var pnr = cards[i].querySelector('.service-entry-prosjektnr');
            if (!pnr || !pnr.value.trim()) {
                showNotificationModal(t('required_field', t('label_prosjektnr')) + ' (' + t('service_entry_title') + ' ' + (i + 1) + ')');
                return false;
            }
        }
        if (req.prosjektnavn !== false) {
            var pnavn = cards[i].querySelector('.service-entry-prosjektnavn');
            if (!pnavn || !pnavn.value.trim()) {
                showNotificationModal(t('required_field', t('label_prosjektnavn')) + ' (' + t('service_entry_title') + ' ' + (i + 1) + ')');
                return false;
            }
        }
        if (req.materialer !== false) {
            var matContainer = cards[i].querySelector('.mobile-order-materials');
            var matItems = matContainer ? matContainer.querySelectorAll('.mobile-material-row') : [];
            if (matItems.length === 0) {
                showNotificationModal(t('required_field', t('order_materials_label')) + ' (' + t('service_entry_title') + ' ' + (i + 1) + ')');
                return false;
            }
        }
    }

    // Signature
    if (req.signatur) {
        var sigInput = document.getElementById('service-signatur');
        if (!sigInput || !sigInput.value) {
            showNotificationModal(t('required_field', t('validation_signatur')));
            return false;
        }
    }

    return true;
}

function _clearSentStateAfterSave() {
    if (sessionStorage.getItem('firesafe_current_sent') === '1') {
        sessionStorage.removeItem('firesafe_current_sent');
        document.getElementById('sent-banner').style.display = 'none';
        var btnFormSent = document.getElementById('btn-form-sent');
        if (btnFormSent) btnFormSent.style.display = '';
    }
}

async function saveForm() {
    if (!validateRequiredFields()) return;

    // Validate order number against registered ranges (use cache for instant validation)
    const orderNr = document.getElementById('mobile-ordreseddel-nr').value.trim();
    const orderSettings = typeof _getCachedOrderNrSettings === 'function' ? _getCachedOrderNrSettings() : await getOrderNrSettings();
    const ranges = (orderSettings && orderSettings.ranges) ? orderSettings.ranges : [];

    const saveBtn = document.getElementById('header-save-btn');
    if (saveBtn && saveBtn.disabled) return;
    if (saveBtn) saveBtn.disabled = true;

    try {
        const data = getFormData();

        const formsCollection = 'forms';
        const archiveCollection = 'archive';

        // Always use localStorage first (optimistic)
        const saved = safeParseJSON(STORAGE_KEY, []);
        const archived = safeParseJSON(ARCHIVE_KEY, []);

        // Sjekk sendte for duplikater
        var archivedIdx = archived.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
        if (archivedIdx !== -1) {
            if (sessionStorage.getItem('firesafe_current_sent') === '1') {
                // Bevar ID fra arkivert skjema slik at det oppdateres, ikke dupliseres
                data.id = archived[archivedIdx].id;
                // Arkiv-fjerning skjer i confirm-callback nedenfor, ikke her
            } else {
                showNotificationModal(t('duplicate_in_sent', data.ordreseddelNr));
                return;
            }
        }

        const existingIndex = saved.findIndex(item =>
            item.ordreseddelNr === data.ordreseddelNr
        );

        if (existingIndex !== -1) {
            var isSent = sessionStorage.getItem('firesafe_current_sent') === '1';
            showConfirmModal(t(isSent ? 'confirm_move_to_saved' : 'confirm_update'), function() {
                // Fjern fra arkiv først (hvis sendt skjema)
                if (archivedIdx !== -1) {
                    var freshArchived = safeParseJSON(ARCHIVE_KEY, []);
                    var idx = freshArchived.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
                    if (idx !== -1) {
                        freshArchived.splice(idx, 1);
                        safeSetItem(ARCHIVE_KEY, JSON.stringify(freshArchived));
                    }
                }
                data.id = saved[existingIndex].id;
                saved[existingIndex] = data;
                safeSetItem(STORAGE_KEY, JSON.stringify(saved));
                addToOrderNumberIndex(data.ordreseddelNr);
                loadedForms = [];
                lastSavedData = getFormDataSnapshot();
                _clearSentStateAfterSave();
                _lastLocalSaveTs = Date.now();
                showNotificationModal(t('save_success'), true); showSavedForms();

                // Firebase: serialisert via _pendingFirestoreOps
                if (currentUser && db) {
                    var formsRef = db.collection('users').doc(currentUser.uid).collection(formsCollection);
                    var archiveRef = db.collection('users').doc(currentUser.uid).collection(archiveCollection);
                    var docId = data.id;
                    _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
                        return formsRef.doc(docId).set(data);
                    }).then(function() {
                        if (archivedIdx !== -1) return archiveRef.doc(docId).delete();
                    }).catch(function(e) { console.error('Firestore save error:', e); });
                }
            }, t('btn_update'), '#E8501A');
        } else {
            // Save new form directly (no confirmation needed)
            // Fjern fra arkiv først (hvis sendt skjema)
            if (archivedIdx !== -1) {
                var freshArchived2 = safeParseJSON(ARCHIVE_KEY, []);
                var idx2 = freshArchived2.findIndex(function(item) { return item.ordreseddelNr === data.ordreseddelNr; });
                if (idx2 !== -1) {
                    freshArchived2.splice(idx2, 1);
                    safeSetItem(ARCHIVE_KEY, JSON.stringify(freshArchived2));
                }
            }
            if (!data.id) data.id = Date.now().toString();
            saved.unshift(data);
            if (saved.length > 50) saved.pop();
            safeSetItem(STORAGE_KEY, JSON.stringify(saved));
            addToOrderNumberIndex(data.ordreseddelNr);
            loadedForms = [];
            lastSavedData = getFormDataSnapshot();
            _clearSentStateAfterSave();
            _lastLocalSaveTs = Date.now();
            showNotificationModal(t('save_success'), true); showSavedForms();

            // Firebase: serialisert via _pendingFirestoreOps
            if (currentUser && db) {
                var formsRef = db.collection('users').doc(currentUser.uid).collection(formsCollection);
                var archiveRef = db.collection('users').doc(currentUser.uid).collection(archiveCollection);
                var docId = data.id;
                var hadArchived = archivedIdx !== -1;
                _pendingFirestoreOps = _pendingFirestoreOps.then(function() {
                    return formsRef.doc(docId).set(data);
                }).then(function() {
                    if (hadArchived) return archiveRef.doc(docId).delete();
                }).catch(function(e) { console.error('Firestore save error:', e); });
            }
        }
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

