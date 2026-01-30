const STORAGE_KEY = 'firesafe_ordresedler';
const ARCHIVE_KEY = 'firesafe_arkiv';
const TEMPLATE_KEY = 'firesafe_maler';
const SETTINGS_KEY = 'firesafe_settings';
const DEFAULTS_KEY = 'firesafe_defaults';

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

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
} catch (e) {
    console.log('Firebase ikke konfigurert ennå');
}

// Auth state listener
if (auth) {
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        updateLoginButton();
        loadedForms = [];
        loadedSentForms = [];
        // Load language preference from Firebase
        if (user && db) {
            try {
                const doc = await db.collection('users').doc(user.uid).collection('settings').doc('language').get();
                if (doc.exists && doc.data().lang) {
                    currentLang = doc.data().lang;
                    localStorage.setItem('firesafe_lang', currentLang);
                    applyTranslations();
                }
            } catch (e) {}
        }
    });
}

function updateLoginButton() {
    const btn = document.getElementById('btn-login');
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

// Helper: Save forms (to Firestore if logged in, else localStorage)
async function setSavedForms(forms) {
    if (currentUser && db) {
        // Firestore: we handle individual docs, not the whole array
        // This function is mainly for localStorage fallback
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(forms));
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

// Track last saved form data for unsaved changes detection
let lastSavedData = null;
let preNewFormData = null;

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

// Always use mobile form for input
function isMobile() {
    return true;
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
        span.style.cssText = `
            color: #c00;
            font-size: 28px;
            font-weight: normal;
            letter-spacing: 3px;
            font-family: Arial, Helvetica, sans-serif;
            line-height: 1;
        `;

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

// --- Order card functions ---
const deleteIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

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
                <input type="text" class="mobile-order-desc" readonly autocapitalize="sentences">
            </div>
            <div class="mobile-order-materials-section">
                <label class="mobile-order-sublabel" data-i18n="order_materials_label">${t('order_materials_label')}</label>
                <div class="mobile-order-materials"></div>
                <button type="button" class="mobile-add-mat-btn" onclick="addMaterialToOrder(this)" data-i18n="order_add_material">${t('order_add_material')}</button>
            </div>
            <div class="mobile-work-row">
                <div class="mobile-field" style="flex:1">
                    <label data-i18n="order_hours">${t('order_hours')}</label>
                    <input type="text" class="mobile-order-timer" inputmode="decimal">
                </div>
            </div>
        </div>`;

    // Set description with data-full-value
    const descInput = card.querySelector('.mobile-order-desc');
    descInput.setAttribute('data-full-value', desc);
    const descLines = desc.split('\n').filter(l => l.trim());
    descInput.value = descLines.length > 1 ? descLines[0] + '...' : (descLines[0] || '');

    // Set timer
    card.querySelector('.mobile-order-timer').value = orderData.timer || '';

    // Add materials
    const matContainer = card.querySelector('.mobile-order-materials');
    const mats = orderData.materials && orderData.materials.length > 0 ? orderData.materials : [{ name: '', antall: '', enhet: '' }];
    mats.forEach(m => {
        matContainer.appendChild(createMaterialRow(m));
    });
    updateMatDeleteStates(matContainer);

    // Set up description click → text editor
    descInput.addEventListener('click', function() {
        openTextEditor(this, t('order_description'));
    });

    return card;
}

function createMaterialRow(m) {
    const div = document.createElement('div');
    div.className = 'mobile-material-row';
    div.innerHTML = `
        <div class="mobile-field"><input type="text" class="mobile-mat-name" placeholder="${t('placeholder_material')}" data-i18n-placeholder="placeholder_material" autocapitalize="sentences" value="${(m.name || '').replace(/"/g, '&quot;')}"></div>
        <div class="mobile-work-row">
            <div class="mobile-field"><input type="text" class="mobile-mat-antall" placeholder="${t('placeholder_quantity')}" data-i18n-placeholder="placeholder_quantity" value="${(m.antall || '').replace(/"/g, '&quot;')}"></div>
            <div class="mobile-field"><input type="text" class="mobile-mat-enhet" placeholder="${t('placeholder_unit')}" data-i18n-placeholder="placeholder_unit" autocapitalize="sentences" value="${(m.enhet || '').replace(/"/g, '&quot;')}"></div>
            <button type="button" class="mobile-mat-remove" onclick="removeMaterialFromOrder(this)">${deleteIcon}</button>
        </div>`;
    return div;
}

function updateMatDeleteStates(matContainer) {
    const rows = matContainer.querySelectorAll('.mobile-material-row');
    const buttons = matContainer.querySelectorAll('.mobile-mat-remove');
    buttons.forEach(btn => { btn.disabled = rows.length <= 1; });
}

function addMaterialToOrder(btn) {
    const matContainer = btn.closest('.mobile-order-body').querySelector('.mobile-order-materials');
    const row = createMaterialRow({ name: '', antall: '', enhet: '' });
    matContainer.appendChild(row);
    updateMatDeleteStates(matContainer);
    row.querySelector('.mobile-mat-name').focus();
}

function removeMaterialFromOrder(btn) {
    const row = btn.closest('.mobile-material-row');
    const matContainer = row.closest('.mobile-order-materials');
    row.remove();
    updateMatDeleteStates(matContainer);
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
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
        const materials = [];
        card.querySelectorAll('.mobile-material-row').forEach(row => {
            const name = row.querySelector('.mobile-mat-name').value;
            const antall = row.querySelector('.mobile-mat-antall').value;
            const enhet = row.querySelector('.mobile-mat-enhet').value;
            if (name || antall || enhet) {
                materials.push({ name, antall, enhet });
            }
        });
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

    // Build desktop work lines dynamically
    buildDesktopWorkLines();
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
        if (options && options.alignRight) descContent.style.textAlign = 'right';
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
            addRow('Materiell:', '', '', { bold: true });
            filledMats.forEach(m => {
                addRow(m.name, m.antall, m.enhet);
            });
        }

        // Timer
        if (order.timer) {
            addRow('Timer:', order.timer, 'timer', { bold: true });
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
        savedAt: new Date().toISOString()
    };
}

function setFormData(data) {
    // Set simple fields
    document.getElementById('ordreseddel-nr').value = data.ordreseddelNr || '';
    document.getElementById('oppdragsgiver').value = data.oppdragsgiver || '';
    document.getElementById('kundens-ref').value = data.kundensRef || '';
    document.getElementById('fakturaadresse').value = data.fakturaadresse || '';
    document.getElementById('dato').value = data.dato || '';
    document.getElementById('prosjektnr').value = data.prosjektnr || '';
    document.getElementById('prosjektnavn').value = data.prosjektnavn || '';
    document.getElementById('montor').value = data.montor || '';
    document.getElementById('avdeling').value = data.avdeling || '';
    document.getElementById('sted').value = data.sted || '';
    document.getElementById('signering-dato').value = data.signeringDato || '';
    document.getElementById('kundens-underskrift').value = data.kundensUnderskrift || '';

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
        if (!document.getElementById(field.id).value.trim()) {
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

    const saveBtn = document.querySelector('.btn-save');
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;

    try {
        const data = getFormData();

        if (currentUser && db) {
            // Lagre til Firestore
            try {
                const formsRef = db.collection('users').doc(currentUser.uid).collection('forms');
                const existing = await formsRef.where('ordreseddelNr', '==', data.ordreseddelNr).get();

                // Sjekk også sendte for duplikater
                const archiveRef = db.collection('users').doc(currentUser.uid).collection('archive');
                const existingArchive = await archiveRef.where('ordreseddelNr', '==', data.ordreseddelNr).get();
                if (!existingArchive.empty) {
                    showNotificationModal(t('duplicate_in_sent', data.ordreseddelNr));
                    return;
                }

                if (!existing.empty) {
                    showConfirmModal(t('confirm_update'), async function() {
                        await formsRef.doc(existing.docs[0].id).set(data);
                        loadedForms = [];
                        lastSavedData = getFormDataSnapshot();
                        showNotificationModal(t('update_success'), true);
                    }, t('btn_update'), '#E8501A');
                } else {
                    showConfirmModal(t('confirm_save'), async function() {
                        data.id = Date.now().toString();
                        await formsRef.doc(data.id).set(data);
                        loadedForms = [];
                        lastSavedData = getFormDataSnapshot();
                        showNotificationModal(t('save_success'), true);
                    }, t('btn_save'), '#E8501A');
                }
            } catch (e) {
                console.error('Firestore save error:', e);
                showNotificationModal(t('save_error') + e.message);
            }
        } else {
            // Fallback til localStorage
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            const archived = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');

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
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
                    loadedForms = [];
                    lastSavedData = getFormDataSnapshot();
                    showNotificationModal(t('update_success'), true);
                }, t('btn_update'), '#E8501A');
            } else {
                showConfirmModal(t('confirm_save'), function() {
                    data.id = Date.now().toString();
                    saved.unshift(data);
                    if (saved.length > 50) saved.pop();
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
                    loadedForms = [];
                    lastSavedData = getFormDataSnapshot();
                    showNotificationModal(t('save_success'), true);
                }, t('btn_save'), '#E8501A');
            }
        }
    } finally {
        saveBtn.disabled = false;
    }
}

// Cache for loaded forms (to use with index-based functions)
let loadedForms = [];

async function showSavedForms() {
    const listEl = document.getElementById('saved-list');
    listEl.innerHTML = '<div class="no-saved">' + t('loading') + '</div>';
    document.getElementById('saved-modal').classList.add('active');

    // Åpne sendte-fanen hvis vi ser på et sendt skjema
    const isSent = document.getElementById('sent-banner').style.display !== 'none';
    if (isSent) {
        switchHentTab('archived');
    }

    const saved = await getSavedForms();
    loadedForms = saved; // Cache for loadForm/deleteForm

    if (saved.length === 0) {
        listEl.innerHTML = '<div class="no-saved">' + t('no_saved_forms') + '</div>';
    } else {
        listEl.innerHTML = saved.map((item, index) => {
            const prosjektnavn = item.prosjektnavn || '';
            const ordrenr = item.ordreseddelNr || '';
            const oppdragsgiver = item.oppdragsgiver || '';
            const dato = item.dato || '';
            const prosjektnr = item.prosjektnr || '';

            const row1 = [prosjektnavn, oppdragsgiver].filter(x => x).join(' • ') || t('no_name');
            const row2 = [dato, prosjektnr].filter(x => x).join(' • ');
            const row3 = ordrenr ? `${t('order_prefix')}${ordrenr}` : '';

            return `
                <div class="saved-item" onclick="loadForm(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${row1}</div>
                        ${row2 ? `<div class="saved-item-row2">${row2}</div>` : ''}
                        ${row3 ? `<div class="saved-item-row3">${row3}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        <button class="saved-item-icon-btn duplicate" onclick="duplicateForm(event, ${index})" title="Dupliser"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button>
                        <button class="saved-item-icon-btn delete" onclick="deleteForm(event, ${index})" title="Slett"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function setFormReadOnly(readOnly) {
    const fields = document.querySelectorAll('#mobile-form input, #mobile-form textarea, #mobile-form select, #form-container input, #form-container textarea, #form-container select');
    fields.forEach(el => el.disabled = readOnly);
    document.querySelector('.btn-save').disabled = readOnly;
    document.getElementById('sent-banner').style.display = readOnly ? 'block' : 'none';
}

function loadForm(index) {
    if (loadedForms[index]) {
        setFormData(loadedForms[index]);
        lastSavedData = getFormDataSnapshot();
        setFormReadOnly(false);
        closeModal();
    }
}

async function duplicateForm(event, index) {
    event.stopPropagation();
    const form = loadedForms[index];
    if (!form) return;

    setFormData(form);
    // Tøm ordrenummer og sett nytt
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    await autoFillOrderNumber();
    lastSavedData = null;
    setFormReadOnly(false);
    closeModal();
    showNotificationModal(t('duplicated_success'), true);
}

function deleteForm(event, index) {
    event.stopPropagation();
    showConfirmModal(t('delete_confirm'), async function() {
        const form = loadedForms[index];
        if (!form) return;

        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection('forms').doc(form.id).delete();
            } catch (e) {
                console.error('Delete error:', e);
            }
        } else {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            saved.splice(index, 1);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        }
        showSavedForms();
    });
}

function closeModal() {
    document.getElementById('saved-modal').classList.remove('active');
    document.getElementById('saved-search').value = '';
    document.getElementById('sent-search').value = '';
    // Reset to saved tab
    switchHentTab('saved');
}

function switchHentTab(tab) {
    const tabs = document.querySelectorAll('#saved-modal .modal-tab');
    tabs.forEach(t => t.classList.remove('active'));

    const savedList = document.getElementById('saved-list');
    const sentList = document.getElementById('sent-list');
    const savedSearch = document.getElementById('saved-search').closest('.modal-search');
    const sentSearch = document.getElementById('sent-search-wrap');

    if (tab === 'saved') {
        tabs[0].classList.add('active');
        savedList.style.display = '';
        sentList.style.display = 'none';
        savedSearch.style.display = '';
        sentSearch.style.display = 'none';
    } else {
        tabs[1].classList.add('active');
        savedList.style.display = 'none';
        sentList.style.display = '';
        savedSearch.style.display = 'none';
        sentSearch.style.display = '';
        // Load sent forms when switching to tab
        loadSentTab();
    }
}

async function loadSentTab() {
    const listEl = document.getElementById('sent-list');
    listEl.innerHTML = '<div class="no-saved">' + t('loading') + '</div>';

    const archived = await getSentForms();
    loadedSentForms = archived;

    if (archived.length === 0) {
        listEl.innerHTML = '<div class="no-saved">' + t('no_sent_forms') + '</div>';
    } else {
        listEl.innerHTML = archived.map((item, index) => {
            const prosjektnavn = item.prosjektnavn || '';
            const ordrenr = item.ordreseddelNr || '';
            const oppdragsgiver = item.oppdragsgiver || '';
            const dato = item.dato || '';
            const prosjektnr = item.prosjektnr || '';

            const row1 = [prosjektnavn, oppdragsgiver].filter(x => x).join(' • ') || t('no_name');
            const row2 = [dato, prosjektnr].filter(x => x).join(' • ');
            const row3 = ordrenr ? `${t('order_prefix')}${ordrenr}` : '';

            return `
                <div class="saved-item" onclick="loadSentForm(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${row1}</div>
                        ${row2 ? `<div class="saved-item-row2">${row2}</div>` : ''}
                        ${row3 ? `<div class="saved-item-row3">${row3}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        <button class="saved-item-icon-btn restore" onclick="moveToSaved(event, ${index})" title="Flytt til lagrede"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg></button>
                        <button class="saved-item-icon-btn delete" onclick="deleteSentForm(event, ${index})" title="Slett"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// Action popup
function showActionPopup(title, actions) {
    const popup = document.getElementById('action-popup');
    document.getElementById('action-popup-title').textContent = title;
    const buttonsEl = document.getElementById('action-popup-buttons');
    buttonsEl.innerHTML = '<div class="confirm-modal-buttons">' + actions.map(a =>
        `<button class="confirm-btn-ok" style="background:#2c3e50" onclick="${a.onclick}; closeActionPopup()">${a.label}</button>`
    ).join('') + '</div>' +
    '<div class="confirm-modal-buttons" style="margin-top:10px"><button class="confirm-btn-cancel" style="flex:1" onclick="closeActionPopup()">' + t('btn_cancel') + '</button></div>';
    popup.classList.add('active');
}

function closeActionPopup(e) {
    if (e && e.target !== document.getElementById('action-popup')) return;
    document.getElementById('action-popup').classList.remove('active');
}

function showSaveMenu() {
    showActionPopup(t('save_menu_title'), [
        { label: t('save_option'), onclick: 'saveForm()' },
        { label: t('save_as_template'), onclick: 'saveAsTemplate()' }
    ]);
}

// Keep old names for compatibility
function closeSaveMenu() { closeActionPopup(); }
function closeExportMenu() { closeActionPopup(); }
function showExportMenu() {
    const isSent = document.getElementById('sent-banner').style.display !== 'none';
    const popup = document.getElementById('action-popup');
    document.getElementById('action-popup-title').textContent = t('export_title');
    const buttonsEl = document.getElementById('action-popup-buttons');
    let html = '';
    if (!isSent) {
        html += '<div style="font-size:12px;color:#888;margin-bottom:4px;">' + t('export_only_label') + '</div>';
    }
    html += '<div class="confirm-modal-buttons">' +
            '<button class="confirm-btn-ok" style="background:#2c3e50" onclick="doExportPDF(); closeActionPopup()">PDF</button>' +
            '<button class="confirm-btn-ok" style="background:#2c3e50" onclick="doExportJPG(); closeActionPopup()">JPG</button>' +
        '</div>';
    if (!isSent) {
        html += '<div style="font-size:12px;color:#888;margin:10px 0 4px;">' + t('export_and_mark_label') + '</div>' +
            '<div class="confirm-modal-buttons">' +
                '<button class="confirm-btn-ok" style="background:#E8501A" onclick="markAsSentAndExport(\'pdf\'); closeActionPopup()">PDF</button>' +
                '<button class="confirm-btn-ok" style="background:#E8501A" onclick="markAsSentAndExport(\'jpg\'); closeActionPopup()">JPG</button>' +
            '</div>';
    }
    html += '<div class="confirm-modal-buttons" style="margin-top:10px"><button class="confirm-btn-cancel" style="flex:1" onclick="closeActionPopup()">' + t('btn_cancel') + '</button></div>';
    buttonsEl.innerHTML = html;
    popup.classList.add('active');
}

function filterSavedForms() {
    const searchTerm = document.getElementById('saved-search').value.toLowerCase();
    const items = document.querySelectorAll('#saved-list .saved-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
    });
}

function filterSentForms() {
    const searchTerm = document.getElementById('sent-search').value.toLowerCase();
    const items = document.querySelectorAll('#sent-list .saved-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
    });
}

async function markAsSent() {
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value;
    if (!ordrenr) return;

    const saved = await getSavedForms();
    const formIndex = saved.findIndex(f => f.ordreseddelNr === ordrenr);
    if (formIndex === -1) return;

    const form = saved[formIndex];

    if (currentUser && db) {
        try {
            await db.collection('users').doc(currentUser.uid).collection('archive').doc(form.id).set(form);
            await db.collection('users').doc(currentUser.uid).collection('forms').doc(form.id).delete();
        } catch (e) {
            console.error('Mark as sent error:', e);
        }
    } else {
        const localSaved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const archived = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
        const f = localSaved.splice(formIndex, 1)[0];
        archived.unshift(f);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(localSaved));
        localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archived));
    }

    showNotificationModal(t('marked_as_sent'), true);
}

async function moveCurrentToSaved() {
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value;
    if (!ordrenr) return;

    const sent = await getSentForms();
    const formIndex = sent.findIndex(f => f.ordreseddelNr === ordrenr);
    if (formIndex === -1) return;

    const form = sent[formIndex];

    if (currentUser && db) {
        try {
            await db.collection('users').doc(currentUser.uid).collection('forms').doc(form.id).set(form);
            await db.collection('users').doc(currentUser.uid).collection('archive').doc(form.id).delete();
        } catch (e) {
            console.error('Move to saved error:', e);
        }
    } else {
        const archived = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const f = archived.splice(formIndex, 1)[0];
        saved.unshift(f);
        localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archived));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    }

    setFormReadOnly(false);
    showNotificationModal(t('move_to_saved_success'), true);
}

// Cache for sent forms
let loadedSentForms = [];

function loadSentForm(index) {
    if (loadedSentForms[index]) {
        setFormData(loadedSentForms[index]);
        lastSavedData = getFormDataSnapshot();
        setFormReadOnly(true);
        closeSentModal();
    }
}

function moveToSaved(event, index) {
    event.stopPropagation();
    showConfirmModal(t('move_to_saved_confirm'), async function() {
        const form = loadedSentForms[index];
        if (!form) return;

        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection('forms').doc(form.id).set(form);
                await db.collection('users').doc(currentUser.uid).collection('archive').doc(form.id).delete();
            } catch (e) {
                console.error('Restore error:', e);
            }
        } else {
            const archived = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            const f = archived.splice(index, 1)[0];
            saved.unshift(f);
            localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archived));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        }

        // Hvis det åpne skjemaet er det som ble flyttet, fjern sendt-modus
        const currentOrdrenr = document.getElementById('mobile-ordreseddel-nr').value;
        if (currentOrdrenr && form.ordreseddelNr === currentOrdrenr) {
            setFormReadOnly(false);
        }

        await showSavedForms();
        switchHentTab('saved');
        showNotificationModal(t('move_to_saved_success'), true);
    }, t('btn_move'), '#333');
}

function deleteSentForm(event, index) {
    event.stopPropagation();
    showConfirmModal(t('delete_sent_confirm'), async function() {
        const form = loadedSentForms[index];
        if (!form) return;

        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection('archive').doc(form.id).delete();
            } catch (e) {
                console.error('Delete archived error:', e);
            }
        } else {
            const archived = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
            archived.splice(index, 1);
            localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archived));
        }
        loadSentTab();
    });
}

function closeSentModal() {
    closeModal();
}

// ============================================
// PROSJEKTMALER
// ============================================

let loadedTemplates = [];

async function getTemplates() {
    if (currentUser && db) {
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('templates').orderBy('prosjektnavn').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error('Templates error:', e);
            return JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        }
    }
    return JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
}

async function saveAsTemplate() {
    // Sync mobile to original first
    if (isMobile()) {
        syncMobileToOriginal();
    }

    const prosjektnavn = document.getElementById('prosjektnavn').value.trim();
    if (!prosjektnavn) {
        showNotificationModal(t('template_name_required'));
        return;
    }

    const templateData = {
        prosjektnavn: prosjektnavn,
        prosjektnr: document.getElementById('prosjektnr').value.trim(),
        oppdragsgiver: document.getElementById('oppdragsgiver').value.trim(),
        avdeling: document.getElementById('avdeling').value.trim(),
        sted: document.getElementById('sted').value.trim(),
        createdAt: new Date().toISOString(),
        createdBy: currentUser ? currentUser.uid : 'local'
    };

    if (currentUser && db) {
        try {
            const templatesRef = db.collection('users').doc(currentUser.uid).collection('templates');
            const existing = await templatesRef.where('prosjektnavn', '==', templateData.prosjektnavn).get();

            if (!existing.empty) {
                showConfirmModal(t('template_exists', templateData.prosjektnavn), async function() {
                    await templatesRef.doc(existing.docs[0].id).set(templateData);
                    showNotificationModal(t('template_update_success'), true);
                }, t('btn_update'), '#E8501A');
            } else {
                const docId = Date.now().toString();
                await templatesRef.doc(docId).set(templateData);
                showNotificationModal(t('template_save_success'), true);
            }
        } catch (e) {
            console.error('Save template error:', e);
            showNotificationModal(t('template_save_error') + e.message);
        }
    } else {
        // localStorage fallback
        const templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        const existingIndex = templates.findIndex(t => t.prosjektnavn.toLowerCase() === templateData.prosjektnavn.toLowerCase());

        if (existingIndex !== -1) {
            showConfirmModal(t('template_exists', templateData.prosjektnavn), function() {
                templateData.id = templates[existingIndex].id;
                templates[existingIndex] = templateData;
                localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
                showNotificationModal(t('template_update_success'), true);
            }, t('btn_update'), '#E8501A');
        } else {
            templateData.id = Date.now().toString();
            templates.push(templateData);
            localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
            showNotificationModal(t('template_save_success'), true);
        }
    }
}

async function showTemplateModal() {
    const listEl = document.getElementById('template-list');
    listEl.innerHTML = '<div class="no-saved">' + t('loading') + '</div>';
    document.getElementById('template-modal').classList.add('active');

    const templates = await getTemplates();
    loadedTemplates = templates;

    if (templates.length === 0) {
        listEl.innerHTML = '<div class="no-saved">' + t('no_templates') + '</div>';
    } else {
        listEl.innerHTML = templates.map((item, index) => {
            const row1 = item.prosjektnavn || t('no_name');
            const row2 = [item.oppdragsgiver, item.prosjektnr].filter(x => x).join(' • ');
            const row3 = [item.avdeling, item.sted].filter(x => x).join(' • ');

            return `
                <div class="saved-item" onclick="loadTemplate(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${row1}</div>
                        ${row2 ? `<div class="saved-item-row2">${row2}</div>` : ''}
                        ${row3 ? `<div class="saved-item-row3">${row3}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        <button class="saved-item-icon-btn delete" onclick="deleteTemplate(event, ${index})" title="Slett"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

async function autoFillOrderNumber() {
    const nextNr = await getNextOrderNumber();
    if (nextNr !== null) {
        document.getElementById('ordreseddel-nr').value = nextNr;
        document.getElementById('mobile-ordreseddel-nr').value = nextNr;
    }
}

function loadTemplate(index) {
    const template = loadedTemplates[index];
    if (!template) return;

    preNewFormData = null;
    clearForm();
    setFormReadOnly(false);

    // Fill the 5 fields in both forms
    document.getElementById('oppdragsgiver').value = template.oppdragsgiver || '';
    document.getElementById('prosjektnr').value = template.prosjektnr || '';
    document.getElementById('prosjektnavn').value = template.prosjektnavn || '';
    document.getElementById('avdeling').value = template.avdeling || '';
    document.getElementById('sted').value = template.sted || '';

    document.getElementById('mobile-oppdragsgiver').value = template.oppdragsgiver || '';
    document.getElementById('mobile-prosjektnr').value = template.prosjektnr || '';
    document.getElementById('mobile-prosjektnavn').value = template.prosjektnavn || '';
    document.getElementById('mobile-avdeling').value = template.avdeling || '';
    document.getElementById('mobile-sted').value = template.sted || '';

    autoFillOrderNumber();

    document.getElementById('template-modal').classList.remove('active');
    document.getElementById('template-search').value = '';
}

function deleteTemplate(event, index) {
    event.stopPropagation();
    showConfirmModal(t('template_delete_confirm'), async function() {
        const template = loadedTemplates[index];
        if (!template) return;

        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection('templates').doc(template.id).delete();
            } catch (e) {
                console.error('Delete template error:', e);
            }
        } else {
            const templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
            const idx = templates.findIndex(t => t.id === template.id);
            if (idx !== -1) {
                templates.splice(idx, 1);
                localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
            }
        }
        showTemplateModal();
    });
}

function closeTemplateModal() {
    if (preNewFormData) {
        clearForm();
        preNewFormData = null;
        setFormReadOnly(false);
        autoFillOrderNumber();
        autoFillDefaults();
    }
    document.getElementById('template-modal').classList.remove('active');
    document.getElementById('template-search').value = '';
}

function cancelTemplateModal() {
    if (preNewFormData) {
        setFormData(preNewFormData);
        preNewFormData = null;
    }
    document.getElementById('template-modal').classList.remove('active');
    document.getElementById('template-search').value = '';
}

function filterTemplates() {
    const searchTerm = document.getElementById('template-search').value.toLowerCase();
    const items = document.querySelectorAll('#template-list .saved-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
    });
}

// ============================================
// ORDRESEDDELNUMMER INNSTILLINGER
// ============================================

// In-memory ranges for settings modal editing
let settingsRanges = [];

async function getOrderNrSettings() {
    let data = null;
    if (currentUser && db) {
        try {
            const doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').get();
            if (doc.exists) data = doc.data();
        } catch (e) {
            console.error('Settings error:', e);
        }
    }
    if (!data) {
        const stored = localStorage.getItem(SETTINGS_KEY);
        data = stored ? JSON.parse(stored) : null;
    }
    // Backward compat: convert old {nrStart, nrEnd} to {ranges}
    if (data && !data.ranges && data.nrStart != null) {
        data = { ranges: [{ start: data.nrStart, end: data.nrEnd }] };
    }
    return data;
}

async function saveOrderNrSettings() {
    if (settingsRanges.length === 0) {
        showNotificationModal(t('settings_add_range'));
        return;
    }
    const settings = { ranges: settingsRanges.slice() };

    if (currentUser && db) {
        try {
            await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings);
        } catch (e) {
            console.error('Save settings error:', e);
        }
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    showNotificationModal(t('settings_saved'), true);
    closeSettingsModal();
}

function getSettingsPageTitle(page) {
    const titles = {
        ordrenr: t('settings_ordrenr'),
        defaults: t('settings_defaults'),
        language: t('settings_language')
    };
    return titles[page] || '';
}

async function showSettingsModal() {
    showSettingsMenu();
    document.getElementById('settings-modal').classList.add('active');
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
    showSettingsMenu();
}

function showSettingsMenu() {
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    document.getElementById('settings-page-menu').style.display = 'block';
    document.getElementById('settings-header-title').textContent = t('settings_title');
    const header = document.getElementById('settings-header');
    const existingBack = header.querySelector('.settings-back-btn');
    if (existingBack) existingBack.remove();
}

async function showSettingsPage(page) {
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    document.getElementById('settings-page-' + page).style.display = 'block';
    document.getElementById('settings-header-title').textContent = getSettingsPageTitle(page);

    const header = document.getElementById('settings-header');
    if (!header.querySelector('.settings-back-btn')) {
        const backBtn = document.createElement('button');
        backBtn.className = 'settings-back-btn';
        backBtn.innerHTML = '&lsaquo;';
        backBtn.onclick = showSettingsMenu;
        header.insertBefore(backBtn, header.firstChild);
    }

    if (page === 'ordrenr') {
        const settings = await getOrderNrSettings();
        settingsRanges = (settings && settings.ranges) ? settings.ranges.slice() : [];
        renderSettingsRanges();
        document.getElementById('settings-new-start').value = '';
        document.getElementById('settings-new-end').value = '';
        updateSettingsStatus();
    } else if (page === 'defaults') {
        await loadDefaultSettingsToModal();
    } else if (page === 'language') {
        document.getElementById('lang-check-no').textContent = currentLang === 'no' ? '\u2713' : '';
        document.getElementById('lang-check-en').textContent = currentLang === 'en' ? '\u2713' : '';
    }
}

// ============================================
// STANDARDVERDIER (AUTOFYLL)
// ============================================

const DEFAULT_FIELDS = ['montor', 'avdeling', 'oppdragsgiver', 'kundens-ref', 'fakturaadresse', 'prosjektnr', 'prosjektnavn', 'sted'];

async function getDefaultSettings() {
    if (currentUser && db) {
        try {
            const doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults').get();
            if (doc.exists) return doc.data();
        } catch (e) {
            console.error('Defaults error:', e);
        }
    }
    const stored = localStorage.getItem(DEFAULTS_KEY);
    return stored ? JSON.parse(stored) : {};
}

async function saveDefaultSettings() {
    const defaults = {};
    DEFAULT_FIELDS.forEach(field => {
        const val = document.getElementById('default-' + field).value.trim();
        if (val) defaults[field] = val;
    });

    if (currentUser && db) {
        try {
            await db.collection('users').doc(currentUser.uid).collection('settings').doc('defaults').set(defaults);
        } catch (e) {
            console.error('Save defaults error:', e);
        }
    }
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(defaults));
    showNotificationModal(t('settings_defaults_saved'), true);
}

async function loadDefaultSettingsToModal() {
    const defaults = await getDefaultSettings();
    DEFAULT_FIELDS.forEach(field => {
        document.getElementById('default-' + field).value = defaults[field] || '';
    });
}

async function autoFillDefaults() {
    const defaults = await getDefaultSettings();
    DEFAULT_FIELDS.forEach(field => {
        if (defaults[field]) {
            const el = document.getElementById(field);
            const mobileEl = document.getElementById('mobile-' + field);
            if (el) el.value = defaults[field];
            if (mobileEl) mobileEl.value = defaults[field];
        }
    });
}

function renderSettingsRanges() {
    const container = document.getElementById('settings-ranges');
    if (settingsRanges.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_ranges') + '</div>';
        return;
    }
    container.innerHTML = settingsRanges.map((r, idx) =>
        `<div class="settings-range-item">
            <span>${r.start} – ${r.end}</span>
            <button onclick="removeSettingsRange(${idx})" title="${t('btn_remove')}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
        </div>`
    ).join('');
}

async function addSettingsRange() {
    const startInput = document.getElementById('settings-new-start');
    const endInput = document.getElementById('settings-new-end');
    const start = parseInt(startInput.value);
    const end = parseInt(endInput.value);

    if (isNaN(start) || isNaN(end) || start > end) {
        showNotificationModal(t('settings_range_error'));
        return;
    }
    const overlaps = settingsRanges.some(r => start <= r.end && end >= r.start);
    if (overlaps) {
        showNotificationModal(t('settings_range_overlap'));
        return;
    }
    settingsRanges.push({ start, end });
    startInput.value = '';
    endInput.value = '';
    renderSettingsRanges();
    updateSettingsStatus();
    // Auto-save
    const settings = { ranges: settingsRanges.slice() };
    if (currentUser && db) {
        try { await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings); } catch (e) {}
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    showNotificationModal(t('settings_range_added'), true);
}

function removeSettingsRange(idx) {
    const r = settingsRanges[idx];
    showConfirmModal(t('settings_range_remove', r.start, r.end), async function() {
        settingsRanges.splice(idx, 1);
        renderSettingsRanges();
        updateSettingsStatus();
        // Auto-save
        const settings = { ranges: settingsRanges.slice() };
        if (currentUser && db) {
            try { await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings); } catch (e) {}
        }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
}

async function updateSettingsStatus() {
    const statusEl = document.getElementById('settings-status');
    if (settingsRanges.length === 0) {
        statusEl.textContent = '';
        return;
    }

    let total = 0;
    settingsRanges.forEach(r => { total += r.end - r.start + 1; });

    const usedNumbers = await getUsedOrderNumbers();
    let usedCount = 0;
    settingsRanges.forEach(r => {
        for (let n = r.start; n <= r.end; n++) {
            if (usedNumbers.has(String(n))) usedCount++;
        }
    });

    const nextNr = findNextInRanges(settingsRanges, usedNumbers);
    statusEl.textContent = t('settings_used', usedCount, total) + (nextNr ? ' · ' + t('settings_next', nextNr) : ' · ' + t('settings_all_used'));
}

async function getUsedOrderNumbers() {
    const saved = await getSavedForms();
    const archived = await getSentForms();
    const used = new Set();
    saved.forEach(f => { if (f.ordreseddelNr) used.add(String(f.ordreseddelNr)); });
    archived.forEach(f => { if (f.ordreseddelNr) used.add(String(f.ordreseddelNr)); });
    return used;
}

function findNextInRanges(ranges, usedNumbers) {
    for (const r of ranges) {
        for (let n = r.start; n <= r.end; n++) {
            if (!usedNumbers.has(String(n))) return n;
        }
    }
    return null;
}

async function getNextOrderNumber() {
    const settings = await getOrderNrSettings();
    if (!settings || !settings.ranges || settings.ranges.length === 0) return null;
    const usedNumbers = await getUsedOrderNumbers();
    return findNextInRanges(settings.ranges, usedNumbers);
}

function hasAnyFormData() {
    const fields = ['mobile-ordreseddel-nr', 'mobile-oppdragsgiver', 'mobile-prosjektnr', 'mobile-prosjektnavn', 'mobile-montor', 'mobile-avdeling', 'mobile-dato'];
    for (const id of fields) {
        if (document.getElementById(id).value.trim()) return true;
    }
    const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
    for (const card of orderCards) {
        const descInput = card.querySelector('.mobile-order-desc');
        const descVal = descInput.getAttribute('data-full-value') || descInput.value;
        if (descVal.trim()) return true;
    }
    return false;
}

function clearForm() {
    document.querySelectorAll('#form-container input, #form-container textarea').forEach(el => el.value = '');
    document.querySelectorAll('#mobile-form input, #mobile-form textarea').forEach(el => {
        el.value = '';
        el.removeAttribute('data-full-value');
    });

    const today = formatDate(new Date());
    document.getElementById('signering-dato').value = today;
    document.getElementById('mobile-signering-dato').value = today;

    sessionStorage.removeItem('firesafe_current');
    lastSavedData = null;

    // Reset orders to 1 empty card
    const container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    container.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
    updateOrderDeleteStates();

    // Clear desktop work lines
    document.getElementById('work-lines').innerHTML = '';
}

function doNewForm() {
    preNewFormData = getFormData();
    showTemplateModal();
}

function newForm() {
    const currentData = getFormDataSnapshot();
    const hasUnsavedChanges = lastSavedData !== null
        ? currentData !== lastSavedData
        : hasAnyFormData();

    if (hasUnsavedChanges) {
        showConfirmModal(t('new_form_confirm'), doNewForm, t('btn_start_new'), '#E8501A');
    } else {
        doNewForm();
    }
}

// Felles canvas-rendering for eksport/deling
async function renderFormToCanvas() {
    if (isMobile()) {
        syncMobileToOriginal();
    }

    const element = document.getElementById('form-container');
    const originalDisplay = element.style.display;
    const originalPosition = element.style.position;
    const originalLeft = element.style.left;
    const originalWidth = element.style.width;

    element.style.display = 'block';
    element.style.width = '800px';
    element.style.visibility = 'hidden';
    element.style.position = 'fixed';
    element.style.top = '0';
    element.style.left = '0';

    await new Promise(resolve => requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
    }));

    const convertedElements = convertTextareasToDiv();

    await new Promise(resolve => requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
    }));

    element.style.visibility = 'visible';
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '';

    const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
    });

    restoreTextareas(convertedElements);

    element.style.display = originalDisplay;
    element.style.position = originalPosition;
    element.style.left = originalLeft;
    element.style.width = originalWidth;
    element.style.visibility = '';
    element.style.top = '';

    if (isMobile()) {
        element.style.display = 'none';
    }

    return canvas;
}

function getExportFilename(ext) {
    const prosjektnr = document.getElementById('prosjektnr').value || 'ukjent';
    const dato = document.getElementById('dato').value.replace(/\./g, '-') || formatDate(new Date()).replace(/\./g, '-');
    return `ordreseddel_${prosjektnr}_${dato}.${ext}`;
}

async function doExportPDF() {
    if (!validateRequiredFields()) return;
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        const canvas = await renderFormToCanvas();
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, imgWidth, imgHeight);
        pdf.save(getExportFilename('pdf'));
    } catch (error) {
        alert(t('export_pdf_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doExportJPG() {
    if (!validateRequiredFields()) return;
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        const canvas = await renderFormToCanvas();
        const link = document.createElement('a');
        link.download = getExportFilename('jpg');
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
    } catch (error) {
        alert(t('export_jpg_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function markAsSentAndExport(type) {
    if (!validateRequiredFields()) return;
    await markAsSent();
    if (type === 'pdf') {
        await doExportPDF();
    } else {
        await doExportJPG();
    }
    setFormReadOnly(true);
}


document.getElementById('saved-modal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
});


document.getElementById('template-modal').addEventListener('click', function(e) {
    if (e.target === this) cancelTemplateModal();
});

// Sync forms when typing
document.getElementById('mobile-form').addEventListener('input', function() {
    syncMobileToOriginal();
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
});

document.getElementById('form-container').addEventListener('input', function() {
    syncOriginalToMobile();
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
});

window.addEventListener('load', function() {
    const current = sessionStorage.getItem('firesafe_current');
    if (current) {
        try {
            const data = JSON.parse(current);
            if (data.oppdragsgiver || data.prosjektnavn || data.prosjektnr || (data.orders && data.orders.length > 0)) {
                setFormData(data);
            }
        } catch (e) {}
    }
    // Alltid sett signering-dato til dagens dato og tøm kundens underskrift ved oppstart
    const today = formatDate(new Date());
    document.getElementById('signering-dato').value = today;
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-signering-dato').value = today;
    document.getElementById('mobile-kundens-underskrift').value = '';

    // Initialize orders if empty (first load without session data)
    const ordersContainer = document.getElementById('mobile-orders');
    if (ordersContainer && ordersContainer.children.length === 0) {
        ordersContainer.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
        updateOrderDeleteStates();
    }

    // Apply saved language
    applyTranslations();
});

// Keyboard-aware toolbar: sticky when no keyboard, static when keyboard open
(function() {
    if (!window.visualViewport) return;
    var toolbar = document.querySelector('.toolbar');
    var container = document.querySelector('.container');
    if (!toolbar || !container) return;
    function onViewportChange() {
        var offset = window.innerHeight - visualViewport.height - visualViewport.offsetTop;
        if (offset > 50) {
            toolbar.classList.add('keyboard-open');
            container.style.paddingBottom = offset + 'px';
        } else {
            toolbar.classList.remove('keyboard-open');
            container.style.paddingBottom = '';
        }
    }
    visualViewport.addEventListener('resize', onViewportChange);
    visualViewport.addEventListener('scroll', onViewportChange);
})();
