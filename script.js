const STORAGE_KEY = 'firesafe_ordresedler';
const ARCHIVE_KEY = 'firesafe_arkiv';
const TEMPLATE_KEY = 'firesafe_maler';
const SETTINGS_KEY = 'firesafe_settings';
const DEFAULTS_KEY = 'firesafe_defaults';
const MATERIALS_KEY = 'firesafe_materials';
const EXTERNAL_KEY = 'firesafe_external';
const EXTERNAL_ARCHIVE_KEY = 'firesafe_external_arkiv';

// Flag to track if we need to refresh data when auth is ready
let pendingAuthRefresh = null; // 'templates' | 'saved' | null
function sortAlpha(arr) { arr.sort((a, b) => a.localeCompare(b, 'no')); }

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
    localStorage.setItem('firesafe_lang', lang);
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
let isAdmin = false;

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
} catch (e) {
    console.log('Firebase ikke konfigurert ennå');
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
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        isAdmin = false; // Reset admin status
        updateLoginButton();
        loadedForms = [];
        loadedExternalForms = [];

        if (user && db) {
            // Check admin status
            isAdmin = await checkAdminStatus(user.uid);

            // Load language preference from Firebase
            try {
                const doc = await db.collection('users').doc(user.uid).collection('settings').doc('language').get();
                if (doc.exists && doc.data().lang) {
                    currentLang = doc.data().lang;
                    localStorage.setItem('firesafe_lang', currentLang);
                    applyTranslations();
                }
            } catch (e) {}
        }
        // Refresh data if we were waiting for auth (only when user is logged in)
        if (user && pendingAuthRefresh) {
            const refreshType = pendingAuthRefresh;
            pendingAuthRefresh = null; // Clear before calling to avoid loops
            if (refreshType === 'templates' && typeof showTemplateModal === 'function') {
                showTemplateModal();
            } else if (refreshType === 'saved' && typeof showSavedForms === 'function') {
                showSavedForms();
            }
        }
    });
}

function updateLoginButton() {
    const btn = document.getElementById('btn-login-home');
    if (!btn) return;

    if (currentUser) {
        btn.textContent = currentUser.email || currentUser.displayName || t('login');
        btn.classList.add('logged-in');
    } else {
        btn.textContent = t('login');
        btn.classList.remove('logged-in');
    }
}

function handleAuth() {
    if (!auth) {
        showNotificationModal(t('firebase_not_configured'));
        return;
    }

    if (currentUser) {
        // Logg ut
        showConfirmModal(t('logout_confirm'), () => {
            auth.signOut().then(() => {
                showNotificationModal(t('logout_success'), true);
            });
        }, t('logout'), '#6c757d');
    } else {
        // Logg inn med Google
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider)
            .then((result) => {
                showNotificationModal(t('login_success') + result.user.email, true);
            })
            .catch((error) => {
                if (error.code !== 'auth/popup-closed-by-user') {
                    showNotificationModal(t('login_failed') + error.message);
                }
            });
    }
}

// Helper: Get saved forms (from Firestore if logged in, else localStorage)
async function getSavedForms() {
    if (currentUser && db) {
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('forms').orderBy('savedAt', 'desc').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error('Firestore error:', e);
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        }
    }
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}


// Helper: Get sent forms
async function getSentForms() {
    if (currentUser && db) {
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('archive').orderBy('savedAt', 'desc').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error('Firestore error:', e);
            return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
        }
    }
    return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
}

// Helper: Get external forms
async function getExternalForms() {
    if (currentUser && db) {
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('external').orderBy('savedAt', 'desc').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error('Firestore error:', e);
            return JSON.parse(localStorage.getItem(EXTERNAL_KEY) || '[]');
        }
    }
    return JSON.parse(localStorage.getItem(EXTERNAL_KEY) || '[]');
}

// Helper: Get external sent forms
async function getExternalSentForms() {
    if (currentUser && db) {
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('externalArchive').orderBy('savedAt', 'desc').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error('Firestore error:', e);
            return JSON.parse(localStorage.getItem(EXTERNAL_ARCHIVE_KEY) || '[]');
        }
    }
    return JSON.parse(localStorage.getItem(EXTERNAL_ARCHIVE_KEY) || '[]');
}

// Track last saved form data for unsaved changes detection
let lastSavedData = null;
let isExternalForm = false;

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
        const firstLine = lines[0] || '';
        currentEditingField.value = lines.length > 1 ? firstLine + '...' : firstLine;
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

// Auto-resize textarea to fit content
function autoResizeTextarea(textarea) {
    // Set minimal height first to force scrollHeight recalculation
    textarea.style.height = '1px';
    textarea.style.overflow = 'hidden';

    // Force reflow
    void textarea.offsetHeight;

    // Set to scrollHeight
    const minHeight = textarea.classList.contains('work-material') ? 18 : 24;
    textarea.style.height = Math.max(textarea.scrollHeight, minHeight) + 'px';
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
const deleteIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
const copyIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const moveIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';

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
            <div class="mobile-field">
                <label><span data-i18n="order_description">${t('order_description')}</span> <span class="required">*</span></label>
                <textarea class="mobile-order-desc" readonly autocapitalize="sentences"></textarea>
            </div>
            <div class="mobile-order-materials-section">
                <label class="mobile-order-sublabel" data-i18n="order_materials_label">${t('order_materials_label')}</label>
                <div class="mobile-order-materials"></div>
                <button type="button" class="mobile-add-mat-btn" onclick="openMaterialPicker(this)" data-i18n="order_add_material">${t('order_add_material')}</button>
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

    if (isMobile()) {
        // Mobile/tablet: use preview + fullscreen modal
        descInput.setAttribute('data-full-value', desc);
        const descLines = desc.split('\n').filter(l => l.trim());
        const preview = descLines.slice(0, 4).join('\n');
        descInput.value = descLines.length > 4 ? preview + '...' : preview;

        descInput.addEventListener('click', function() {
            openTextEditor(this, t('order_description'));
        });
    } else {
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

function createMaterialSummaryRow(m) {
    const div = document.createElement('div');
    div.className = 'mobile-material-row';
    div.setAttribute('data-mat-name', m.name || '');
    div.setAttribute('data-mat-antall', m.antall || '');
    div.setAttribute('data-mat-enhet', m.enhet || '');
    const nameText = escapeHtml(m.name) || t('placeholder_material');
    const detailParts = [];
    if (m.antall) detailParts.push(escapeHtml(m.antall));
    if (m.enhet) detailParts.push(escapeHtml(m.enhet));
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
        if (m.name || m.antall || m.enhet) {
            matContainer.appendChild(createMaterialSummaryRow(m));
        }
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
    const card = btn.closest('.mobile-order-card');
    pickerOrderCard = card;
    const matContainer = card.querySelector('.mobile-order-materials');
    const existing = getMaterialsFromContainer(matContainer);

    const allMaterials = cachedMaterialOptions || [];
    const allUnits = cachedUnitOptions || [];

    const modal = document.getElementById('picker-overlay');
    const searchInput = document.getElementById('picker-overlay-search');
    const list = document.getElementById('picker-overlay-list');

    searchInput.value = '';

    // Initialize pickerState from existing materials
    pickerState = {};
    existing.forEach(m => {
        if (m.name) {
            pickerState[m.name] = { checked: true, antall: m.antall || '', enhet: m.enhet || '' };
        }
    });

    // HTML escape function - prevents XSS
    function esc(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
    }

    function buildRow(name, isChecked, antall, enhet, needsSpec) {
        const enhetLabel = enhet || t('placeholder_unit');
        const enhetClass = enhet ? '' : ' placeholder';
        const specBadge = needsSpec ? '<span class="picker-mat-spec-dot"></span>' : '';
        const disabledAttr = needsSpec ? ' disabled' : '';
        return `<div class="picker-mat-row${isChecked ? ' picker-mat-selected' : ''}" data-mat-name="${esc(name)}" data-needs-spec="${needsSpec ? '1' : '0'}">
            <div class="picker-mat-check"><span class="picker-mat-name">${esc(name)}</span>${specBadge}</div>
            <input type="text" class="picker-mat-antall" placeholder="${t('placeholder_quantity')}" inputmode="numeric" value="${esc(antall)}"${disabledAttr}>
            <button type="button" class="picker-mat-enhet-btn${enhetClass}" data-enhet="${esc(enhet)}"${disabledAttr}>${esc(enhetLabel)}</button>
        </div>`;
    }

    // Helper: find base material object for a name (checks if it's a spec-derived name)
    function findBaseMaterial(name) {
        return allMaterials.find(m => m.needsSpec && name.toLowerCase().startsWith(m.name.toLowerCase() + ' '));
    }

    function renderPickerList() {
        pickerRenderFn = renderPickerList; // Expose for unitPickerCallback
        // Build list: configured materials + checked spec-derived entries + checked custom entries
        const entries = []; // { name, isChecked, antall, enhet, needsSpec, isSpecDerived }

        // Add all configured materials
        allMaterials.forEach(matObj => {
            if (matObj.needsSpec) {
                // Base spec material: always show as unchecked launcher
                entries.push({ name: matObj.name, isChecked: false, antall: '', enhet: '', needsSpec: true, isSpecDerived: false });
            } else {
                const state = pickerState[matObj.name] || pickerState[Object.keys(pickerState).find(k => k.toLowerCase() === matObj.name.toLowerCase())];
                const isChecked = state && state.checked;
                entries.push({ name: matObj.name, isChecked, antall: state ? (state.antall || '') : '', enhet: state ? (state.enhet || '') : '', needsSpec: false, isSpecDerived: false });
            }
        });

        // Add pickerState entries that are spec-derived or custom
        Object.keys(pickerState).forEach(name => {
            const state = pickerState[name];
            const baseMat = findBaseMaterial(name);
            if (baseMat) {
                // Spec-derived entry (e.g. "Kabelhylser Ø50") — always show while in pickerState
                entries.push({ name, isChecked: state.checked, antall: state.antall || '', enhet: state.enhet || '', needsSpec: false, isSpecDerived: true });
            } else if (state.checked && !allMaterials.some(m => m.name.toLowerCase() === name.toLowerCase())) {
                // Custom entry not in settings — only show when checked
                entries.push({ name, isChecked: true, antall: state.antall || '', enhet: state.enhet || '', needsSpec: false, isSpecDerived: false });
            }
        });

        // Sort alphabetically
        entries.sort((a, b) => a.name.localeCompare(b.name, 'nb'));

        let html = '';
        entries.forEach(e => {
            html += buildRow(e.name, e.isChecked, e.antall, e.enhet, e.needsSpec);
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
            const needsSpec = row.getAttribute('data-needs-spec') === '1';

            nameDiv.addEventListener('click', function() {
                if (needsSpec) {
                    // Open spec popup instead of toggling
                    openSpecPopup(name, function(spec) {
                        const fullName = name + ' ' + spec;
                        pickerState[fullName] = { checked: true, antall: '', enhet: '' };
                        renderPickerList();
                    });
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
                if (!pickerState[name]) pickerState[name] = { checked: false, antall: '', enhet: '' };
                pickerState[name].antall = this.value;
                // Auto-select when both antall and enhet are filled
                if (this.value && pickerState[name].enhet && !pickerState[name].checked) {
                    pickerState[name].checked = true;
                    renderPickerList();
                }
            });

            enhetBtn.addEventListener('click', function(e) {
                e.preventDefault();
                openUnitPicker(name, this);
            });
        });
    }

    function addCustomMaterial() {
        const val = searchInput.value.trim();
        if (!val) return;
        // Check if already exists
        if (allMaterials.some(o => o.name.toLowerCase() === val.toLowerCase()) ||
            (pickerState[val] && pickerState[val].checked)) {
            searchInput.value = '';
            showNotificationModal(t('material_exists'));
            return;
        }
        pickerState[val] = { checked: true, antall: '', enhet: '' };
        // Save to settings so it appears in future pickers
        settingsMaterials = cachedMaterialOptions ? cachedMaterialOptions.slice() : [];
        settingsUnits = cachedUnitOptions ? cachedUnitOptions.slice() : [];
        if (!settingsMaterials.some(m => m.name.toLowerCase() === val.toLowerCase())) {
            settingsMaterials.push({ name: val, needsSpec: false });
            settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
            cachedMaterialOptions = settingsMaterials.slice();
            allMaterials.length = 0;
            allMaterials.push(...cachedMaterialOptions);
            saveMaterialSettings();
        }
        searchInput.value = '';
        renderPickerList();
    }

    renderPickerList();

    // Add custom material on Enter (use onkeydown to avoid listener accumulation)
    searchInput.oninput = null;
    searchInput.onkeydown = function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomMaterial();
        }
    };

    // Add button next to search field
    const addBtn = document.getElementById('picker-overlay-add-btn');
    if (addBtn) {
        addBtn.onclick = function() { addCustomMaterial(); };
    }

    modal.classList.add('active');
}

function closePickerOverlay() {
    document.getElementById('picker-overlay').classList.remove('active');
    pickerOrderCard = null;
}

// Spec popup for materials that need a specification (e.g. size)
let specPopupCallback = null;

function openSpecPopup(baseName, callback) {
    document.getElementById('spec-popup-title').textContent = baseName;
    const input = document.getElementById('spec-popup-input');
    input.value = '';
    input.placeholder = t('spec_popup_placeholder');
    specPopupCallback = callback;
    input.onkeydown = function(e) {
        if (e.key === 'Enter') { e.preventDefault(); confirmSpecPopup(); }
        if (e.key === 'Escape') { e.preventDefault(); closeSpecPopup(); }
    };
    document.getElementById('spec-popup').classList.add('active');
    setTimeout(function() { input.focus(); }, 100);
}

function closeSpecPopup() {
    document.getElementById('spec-popup').classList.remove('active');
    specPopupCallback = null;
}

function confirmSpecPopup() {
    const spec = document.getElementById('spec-popup-input').value.trim();
    if (!spec) return;
    if (specPopupCallback) specPopupCallback(spec);
    closeSpecPopup();
}

function pickerOverlayConfirm() {
    if (!pickerOrderCard) { closePickerOverlay(); return; }

    // Auto-check materials that have both antall and enhet filled
    for (const [name, state] of Object.entries(pickerState)) {
        if (!state.checked && state.antall && state.enhet) {
            state.checked = true;
        }
    }

    // Validate: warn if any material has partial data (antall or enhet but not both)
    const incomplete = [];
    for (const [name, state] of Object.entries(pickerState)) {
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
        if (state.checked) {
            materials.push({ name, antall: state.antall || '', enhet: state.enhet || '' });
        }
    }

    const matContainer = pickerOrderCard.querySelector('.mobile-order-materials');
    renderMaterialSummary(matContainer, materials);
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    closePickerOverlay();
}

// Unit picker overlay
let unitPickerCallback = null;

function openUnitPicker(matName, btnEl) {
    const allUnits = cachedUnitOptions || [];
    const overlay = document.getElementById('unit-picker-overlay');
    const listEl = document.getElementById('unit-picker-list');
    const currentEnhet = btnEl.getAttribute('data-enhet') || '';

    let html = '';
    allUnits.forEach(u => {
        const selected = u === currentEnhet ? ' unit-picker-item-selected' : '';
        html += `<button type="button" class="unit-picker-item${selected}">${escapeHtml(u)}</button>`;
    });

    listEl.innerHTML = html;

    // Show/hide clear button in header
    const headerClearBtn = document.getElementById('unit-picker-clear-btn');
    if (headerClearBtn) {
        headerClearBtn.style.display = currentEnhet ? '' : 'none';
        headerClearBtn.onclick = function() {
            unitPickerCallback('');
            closeUnitPicker();
        };
    }

    // Custom input row (outside scrollable list)
    const isCustom = currentEnhet && !allUnits.some(u => u.toLowerCase() === currentEnhet.toLowerCase());
    const customEl = overlay.querySelector('.unit-picker-custom');
    const customInput = customEl.querySelector('input');
    customInput.value = isCustom ? currentEnhet : '';
    customInput.placeholder = t('picker_custom') + '...';

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
        // Save custom unit to settings
        if (value && !(cachedUnitOptions || []).some(u => u.toLowerCase() === value.toLowerCase())) {
            settingsMaterials = cachedMaterialOptions ? cachedMaterialOptions.slice() : [];
            settingsUnits = cachedUnitOptions ? cachedUnitOptions.slice() : [];
            settingsUnits.push(value);
            sortAlpha(settingsUnits);
            cachedUnitOptions = settingsUnits.slice();
            saveMaterialSettings();
        }
    };

    // Unit item click
    listEl.querySelectorAll('.unit-picker-item').forEach(item => {
        item.addEventListener('click', function() {
            unitPickerCallback(this.textContent);
            closeUnitPicker();
        });
    });

    // Custom OK click (use onclick to avoid listener accumulation)
    const customOk = customEl.querySelector('.unit-picker-custom-ok');
    customOk.onclick = function() {
        const val = customInput.value.trim();
        if (val) {
            unitPickerCallback(val);
            closeUnitPicker();
        }
    };

    overlay.classList.add('active');
}

function closeUnitPicker() {
    document.getElementById('unit-picker-overlay').classList.remove('active');
    unitPickerCallback = null;
}

function toggleOrder(headerEl) {
    const card = headerEl.closest('.mobile-order-card');
    const body = card.querySelector('.mobile-order-body');
    const arrow = card.querySelector('.mobile-order-arrow');
    if (body.style.display === 'none') {
        body.style.display = '';
        arrow.innerHTML = '&#9650;';
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

    if (window.innerHeight > window.innerWidth) {
        // Portrait: CSS rotation to landscape
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
    signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));

    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            initSignatureCanvas();
            redrawSignature();
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
    cleanupSignatureOverlay();
}

function redrawSignature() {
    if (!signatureCanvas || !signatureCtx || signaturePaths.length === 0) return;
    const w = signatureCanvas.clientWidth;
    const h = signatureCanvas.clientHeight;

    signatureCtx.lineCap = 'round';
    signatureCtx.lineJoin = 'round';
    signatureCtx.lineWidth = 3;
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
    signatureCtx.lineWidth = 3;
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

    if (!hasSignature) {
        // Clear signature
        document.getElementById('mobile-kundens-underskrift').value = '';
        document.getElementById('signature-preview-img').style.display = 'none';
        document.querySelector('#mobile-signature-preview .signature-placeholder').style.display = '';
    } else {
        // Generate SVG cropped to signature bounding box (high resolution, bold stroke)
        const svgData = generateSVG(400, 12);

        if (svgData) {
            document.getElementById('mobile-kundens-underskrift').value = svgData;
            const previewImg = document.getElementById('signature-preview-img');
            previewImg.src = svgData;
            previewImg.style.display = 'block';
            document.querySelector('#mobile-signature-preview .signature-placeholder').style.display = 'none';
        }
    }

    // Update backup to current paths (user confirmed, so keep changes)
    signaturePathsBackup = JSON.parse(JSON.stringify(signaturePaths));
    cleanupSignatureOverlay();
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
        // Separator between orders
        if (idx > 0) {
            addRow('', '', '');
        }

        // Description
        if (order.description) {
            addRow(order.description, '', '');
        }

        // Materials
        const filledMats = (order.materials || []).filter(m => m.name || m.antall || m.enhet);
        if (filledMats.length > 0) {
            addRow('Materiell:', '', '', { bold: true, alignRight: true });
            filledMats.forEach(m => {
                addRow(m.name, m.antall, m.enhet, { alignRight: true });
            });
        }

        // Timer
        if (order.timer) {
            addRow('Timer:', order.timer, 'timer', { bold: true, alignRight: true });
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

    // Load signature preview if exists
    const signatureData = document.getElementById('mobile-kundens-underskrift').value;
    if (signatureData && signatureData.startsWith('data:image')) {
        loadSignaturePreview(signatureData);
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
        isExternal: isExternalForm,
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

    isExternalForm = !!data.isExternal;
    updateExternalBadge();

    syncOriginalToMobile();

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
        const expanded = idx === 0; // First order expanded by default
        const card = createOrderCard(order, expanded);
        container.appendChild(card);
    });
    renumberOrders();
    updateOrderDeleteStates();
}

// Validering av påkrevde felter
function validateRequiredFields() {
    const fields = [
        { id: 'mobile-ordreseddel-nr', key: 'validation_ordreseddel_nr' },
        { id: 'mobile-dato', key: 'validation_dato' },
        { id: 'mobile-oppdragsgiver', key: 'validation_oppdragsgiver' },
        { id: 'mobile-prosjektnr', key: 'validation_prosjektnr' },
        { id: 'mobile-prosjektnavn', key: 'validation_prosjektnavn' },
        { id: 'mobile-montor', key: 'validation_montor' },
        { id: 'mobile-avdeling', key: 'validation_avdeling' },
        { id: 'mobile-sted', key: 'validation_sted' },
        { id: 'mobile-signering-dato', key: 'validation_signering_dato' }
    ];

    for (const field of fields) {
        const el = document.getElementById(field.id);
        if (!el || !el.value.trim()) {
            showNotificationModal(t('required_field', t(field.key)));
            return false;
        }
    }

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

    return true;
}

async function saveForm() {
    if (!validateRequiredFields()) return;

    // Validate order number against registered ranges
    const orderNr = document.getElementById('mobile-ordreseddel-nr').value.trim();
    const orderSettings = await getOrderNrSettings();
    const ranges = (orderSettings && orderSettings.ranges) ? orderSettings.ranges : [];
    if (ranges.length > 0) {
        if (!isExternalForm && !isNumberInRanges(orderNr, ranges)) {
            showNotificationModal(t('validation_nr_not_in_range', orderNr));
            return;
        }
        if (isExternalForm && isNumberInRanges(orderNr, ranges)) {
            showNotificationModal(t('validation_nr_is_own'));
            return;
        }
    }

    const saveBtn = document.querySelector('.btn-save');
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;

    try {
        const data = getFormData();

        const formsCollection = isExternalForm ? 'external' : 'forms';
        const archiveCollection = isExternalForm ? 'externalArchive' : 'archive';
        const storageKey = isExternalForm ? EXTERNAL_KEY : STORAGE_KEY;
        const archiveKey = isExternalForm ? EXTERNAL_ARCHIVE_KEY : ARCHIVE_KEY;

        if (currentUser && db) {
            // Lagre til Firestore
            try {
                const formsRef = db.collection('users').doc(currentUser.uid).collection(formsCollection);
                const existing = await formsRef.where('ordreseddelNr', '==', data.ordreseddelNr).get();

                // Sjekk også sendte for duplikater
                const archiveRef = db.collection('users').doc(currentUser.uid).collection(archiveCollection);
                const existingArchive = await archiveRef.where('ordreseddelNr', '==', data.ordreseddelNr).get();
                if (!existingArchive.empty) {
                    showNotificationModal(t('duplicate_in_sent', data.ordreseddelNr));
                    return;
                }

                if (!existing.empty) {
                    showConfirmModal(t('confirm_update'), async function() {
                        await formsRef.doc(existing.docs[0].id).set(data);
                        loadedForms = [];
                        loadedExternalForms = [];
                        lastSavedData = getFormDataSnapshot();
                        showNotificationModal(t('save_success'), true); showSavedForms();
                    }, t('btn_update'), '#E8501A');
                } else {
                    // Save new form directly (no confirmation needed)
                    data.id = Date.now().toString();
                    await formsRef.doc(data.id).set(data);
                    loadedForms = [];
                    loadedExternalForms = [];
                    lastSavedData = getFormDataSnapshot();
                    showNotificationModal(t('save_success'), true); showSavedForms();
                }
            } catch (e) {
                console.error('Firestore save error:', e);
                showNotificationModal(t('save_error') + e.message);
            }
        } else {
            // Fallback til localStorage
            const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
            const archived = JSON.parse(localStorage.getItem(archiveKey) || '[]');

            // Sjekk sendte for duplikater
            if (archived.some(item => item.ordreseddelNr === data.ordreseddelNr)) {
                showNotificationModal(t('duplicate_in_sent', data.ordreseddelNr));
                return;
            }

            const existingIndex = saved.findIndex(item =>
                item.ordreseddelNr === data.ordreseddelNr
            );

            if (existingIndex !== -1) {
                showConfirmModal(t('confirm_update'), function() {
                    data.id = saved[existingIndex].id;
                    saved[existingIndex] = data;
                    localStorage.setItem(storageKey, JSON.stringify(saved));
                    loadedForms = [];
                    loadedExternalForms = [];
                    lastSavedData = getFormDataSnapshot();
                    showNotificationModal(t('save_success'), true); showSavedForms();
                }, t('btn_update'), '#E8501A');
            } else {
                // Save new form directly (no confirmation needed)
                data.id = Date.now().toString();
                saved.unshift(data);
                if (saved.length > 50) saved.pop();
                localStorage.setItem(storageKey, JSON.stringify(saved));
                loadedForms = [];
                loadedExternalForms = [];
                lastSavedData = getFormDataSnapshot();
                showNotificationModal(t('save_success'), true); showSavedForms();
            }
        }
    } finally {
        saveBtn.disabled = false;
    }
}

