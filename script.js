const STORAGE_KEY = 'firesafe_ordresedler';
const ARCHIVE_KEY = 'firesafe_arkiv';
const TEMPLATE_KEY = 'firesafe_maler';
const SETTINGS_KEY = 'firesafe_settings';

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
    auth.onAuthStateChanged((user) => {
        currentUser = user;
        updateLoginButton();
    });
}

function updateLoginButton() {
    const btn = document.getElementById('btn-login');
    if (!btn) return;

    if (currentUser) {
        btn.textContent = currentUser.email || currentUser.displayName || 'Logget inn';
        btn.classList.add('logged-in');
    } else {
        btn.textContent = 'Logg inn';
        btn.classList.remove('logged-in');
    }
}

function handleAuth() {
    if (!auth) {
        showNotificationModal('Firebase er ikke konfigurert. Sjekk firebaseConfig i script.js');
        return;
    }

    if (currentUser) {
        // Logg ut
        showConfirmModal('Vil du logge ut?', () => {
            auth.signOut().then(() => {
                showNotificationModal('Du er nå logget ut', true);
            });
        }, 'Logg ut', '#6c757d');
    } else {
        // Logg inn med Google
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider)
            .then((result) => {
                showNotificationModal('Logget inn som ' + result.user.email, true);
            })
            .catch((error) => {
                if (error.code !== 'auth/popup-closed-by-user') {
                    showNotificationModal('Innlogging feilet: ' + error.message);
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

// Helper: Get archived forms
async function getArchivedForms() {
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
    okBtn.textContent = buttonText || 'Fjern';
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

// No longer needed - desktop form is dynamically generated
function initAutoResize() {}
function resizeAllTextareas() {}

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
            <span class="mobile-order-title">Beskrivelse</span>
            <button type="button" class="mobile-order-header-delete" onclick="event.stopPropagation(); removeOrder(this)">${deleteIcon}</button>
        </div>
        <div class="mobile-order-body" style="${expanded ? '' : 'display:none'}">
            <div class="mobile-field">
                <label>Beskrivelse <span class="required">*</span></label>
                <input type="text" class="mobile-order-desc" readonly autocapitalize="sentences">
            </div>
            <div class="mobile-order-materials-section">
                <label class="mobile-order-sublabel">Materialer</label>
                <div class="mobile-order-materials"></div>
                <button type="button" class="mobile-add-mat-btn" onclick="addMaterialToOrder(this)">+ Material</button>
            </div>
            <div class="mobile-work-row">
                <div class="mobile-field" style="flex:1">
                    <label>Timer</label>
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
        openTextEditor(this, 'Beskrivelse');
    });

    return card;
}

function createMaterialRow(m) {
    const div = document.createElement('div');
    div.className = 'mobile-material-row';
    div.innerHTML = `
        <div class="mobile-field"><input type="text" class="mobile-mat-name" placeholder="Materiale" autocapitalize="sentences" value="${(m.name || '').replace(/"/g, '&quot;')}"></div>
        <div class="mobile-work-row">
            <div class="mobile-field"><input type="text" class="mobile-mat-antall" placeholder="Antall" value="${(m.antall || '').replace(/"/g, '&quot;')}"></div>
            <div class="mobile-field"><input type="text" class="mobile-mat-enhet" placeholder="Enhet" autocapitalize="sentences" value="${(m.enhet || '').replace(/"/g, '&quot;')}"></div>
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
        card.querySelector('.mobile-order-title').textContent = 'Beskrivelse ' + (idx + 1);
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
    showConfirmModal('Slett denne bestillingen?', function() {
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
        { id: 'mobile-ordreseddel-nr', name: 'Ordreseddel nr.' },
        { id: 'mobile-dato', name: 'Dato' },
        { id: 'mobile-oppdragsgiver', name: 'Oppdragsgiver' },
        { id: 'mobile-prosjektnr', name: 'Prosjektnr.' },
        { id: 'mobile-prosjektnavn', name: 'Prosjektnavn' },
        { id: 'mobile-montor', name: 'Montør' },
        { id: 'mobile-avdeling', name: 'Avdeling' },
        { id: 'mobile-sted', name: 'Sted' },
        { id: 'mobile-signering-dato', name: 'Signering dato' }
    ];

    for (const field of fields) {
        if (!document.getElementById(field.id).value.trim()) {
            showNotificationModal('Du må fylle inn ' + field.name);
            return false;
        }
    }

    // Sjekk at minst én bestilling har beskrivelse
    const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
    if (orderCards.length === 0) {
        showNotificationModal('Du må legge til minst én bestilling');
        return false;
    }
    for (let i = 0; i < orderCards.length; i++) {
        const descInput = orderCards[i].querySelector('.mobile-order-desc');
        const descVal = descInput.getAttribute('data-full-value') || descInput.value;
        if (!descVal.trim()) {
            showNotificationModal('Beskrivelse mangler for bestilling ' + (i + 1));
            return false;
        }
    }

    return true;
}

async function saveForm() {
    if (!validateRequiredFields()) return;

    const data = getFormData();

    if (currentUser && db) {
        // Lagre til Firestore
        try {
            const formsRef = db.collection('users').doc(currentUser.uid).collection('forms');
            const existing = await formsRef.where('ordreseddelNr', '==', data.ordreseddelNr).get();

            // Sjekk også arkivet for duplikater
            const archiveRef = db.collection('users').doc(currentUser.uid).collection('archive');
            const existingArchive = await archiveRef.where('ordreseddelNr', '==', data.ordreseddelNr).get();
            if (!existingArchive.empty) {
                showNotificationModal('Ordreseddel nr. ' + data.ordreseddelNr + ' finnes allerede i arkivet.');
                return;
            }

            if (!existing.empty) {
                showConfirmModal('Dette ordrenummeret finnes allerede. Vil du oppdatere det?', async function() {
                    await formsRef.doc(existing.docs[0].id).set(data);
                    lastSavedData = getFormDataSnapshot();
                    showNotificationModal('Skjema oppdatert!', true);
                }, 'Oppdater', '#1abc9c');
            } else {
                showConfirmModal('Er du sikker på at du vil lagre skjemaet?', async function() {
                    data.id = Date.now().toString();
                    await formsRef.doc(data.id).set(data);
                    lastSavedData = getFormDataSnapshot();
                    showNotificationModal('Skjema lagret!', true);
                }, 'Lagre', '#1abc9c');
            }
        } catch (e) {
            console.error('Firestore save error:', e);
            showNotificationModal('Feil ved lagring: ' + e.message);
        }
    } else {
        // Fallback til localStorage
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const archived = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');

        // Sjekk arkivet for duplikater
        if (archived.some(item => item.ordreseddelNr === data.ordreseddelNr)) {
            showNotificationModal('Ordreseddel nr. ' + data.ordreseddelNr + ' finnes allerede i arkivet.');
            return;
        }

        const existingIndex = saved.findIndex(item =>
            item.ordreseddelNr === data.ordreseddelNr
        );

        if (existingIndex !== -1) {
            showConfirmModal('Dette ordrenummeret finnes allerede. Vil du oppdatere det?', function() {
                data.id = saved[existingIndex].id;
                saved[existingIndex] = data;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
                lastSavedData = getFormDataSnapshot();
                showNotificationModal('Skjema oppdatert!', true);
            }, 'Oppdater', '#1abc9c');
        } else {
            showConfirmModal('Er du sikker på at du vil lagre skjemaet?', function() {
                data.id = Date.now().toString();
                saved.unshift(data);
                if (saved.length > 50) saved.pop();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
                lastSavedData = getFormDataSnapshot();
                showNotificationModal('Skjema lagret!', true);
            }, 'Lagre', '#1abc9c');
        }
    }
}

// Cache for loaded forms (to use with index-based functions)
let loadedForms = [];

async function showSavedForms() {
    const listEl = document.getElementById('saved-list');
    listEl.innerHTML = '<div class="no-saved">Laster...</div>';
    document.getElementById('saved-modal').classList.add('active');

    const saved = await getSavedForms();
    loadedForms = saved; // Cache for loadForm/deleteForm

    if (saved.length === 0) {
        listEl.innerHTML = '<div class="no-saved">Ingen lagrede skjemaer</div>';
    } else {
        listEl.innerHTML = saved.map((item, index) => {
            const prosjektnavn = item.prosjektnavn || '';
            const ordrenr = item.ordreseddelNr || '';
            const oppdragsgiver = item.oppdragsgiver || '';
            const dato = item.dato || '';
            const prosjektnr = item.prosjektnr || '';

            const row1 = [prosjektnavn, oppdragsgiver].filter(x => x).join(' • ') || 'Uten navn';
            const row2 = [dato, prosjektnr].filter(x => x).join(' • ');
            const row3 = ordrenr ? `Ordre: ${ordrenr}` : '';

            return `
                <div class="saved-item" onclick="loadForm(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${row1}</div>
                        ${row2 ? `<div class="saved-item-row2">${row2}</div>` : ''}
                        ${row3 ? `<div class="saved-item-row3">${row3}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        <button class="saved-item-icon-btn archive" onclick="archiveForm(event, ${index})" title="Arkiver"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg></button>
                        <button class="saved-item-icon-btn delete" onclick="deleteForm(event, ${index})" title="Slett"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function loadForm(index) {
    if (loadedForms[index]) {
        setFormData(loadedForms[index]);
        lastSavedData = getFormDataSnapshot();
        closeModal();
    }
}

function deleteForm(event, index) {
    event.stopPropagation();
    showConfirmModal('Er du sikker på at du vil slette dette skjemaet?', async function() {
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
    document.getElementById('archive-search').value = '';
    // Reset to saved tab
    switchHentTab('saved');
}

function switchHentTab(tab) {
    const tabs = document.querySelectorAll('#saved-modal .modal-tab');
    tabs.forEach(t => t.classList.remove('active'));

    const savedList = document.getElementById('saved-list');
    const archiveList = document.getElementById('archive-list');
    const savedSearch = document.getElementById('saved-search').closest('.modal-search');
    const archiveSearch = document.getElementById('archive-search-wrap');

    if (tab === 'saved') {
        tabs[0].classList.add('active');
        savedList.style.display = '';
        archiveList.style.display = 'none';
        savedSearch.style.display = '';
        archiveSearch.style.display = 'none';
    } else {
        tabs[1].classList.add('active');
        savedList.style.display = 'none';
        archiveList.style.display = '';
        savedSearch.style.display = 'none';
        archiveSearch.style.display = '';
        // Load archived forms when switching to tab
        loadArchivedTab();
    }
}

async function loadArchivedTab() {
    const listEl = document.getElementById('archive-list');
    listEl.innerHTML = '<div class="no-saved">Laster...</div>';

    const archived = await getArchivedForms();
    loadedArchivedForms = archived;

    if (archived.length === 0) {
        listEl.innerHTML = '<div class="no-saved">Ingen arkiverte skjemaer</div>';
    } else {
        listEl.innerHTML = archived.map((item, index) => {
            const prosjektnavn = item.prosjektnavn || '';
            const ordrenr = item.ordreseddelNr || '';
            const oppdragsgiver = item.oppdragsgiver || '';
            const dato = item.dato || '';
            const prosjektnr = item.prosjektnr || '';

            const row1 = [prosjektnavn, oppdragsgiver].filter(x => x).join(' • ') || 'Uten navn';
            const row2 = [dato, prosjektnr].filter(x => x).join(' • ');
            const row3 = ordrenr ? `Ordre: ${ordrenr}` : '';

            return `
                <div class="saved-item" onclick="loadArchivedForm(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${row1}</div>
                        ${row2 ? `<div class="saved-item-row2">${row2}</div>` : ''}
                        ${row3 ? `<div class="saved-item-row3">${row3}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        <button class="saved-item-icon-btn restore" onclick="restoreForm(event, ${index})" title="Gjenopprett"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg></button>
                        <button class="saved-item-icon-btn delete" onclick="deleteArchivedForm(event, ${index})" title="Slett"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
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
        `<button class="confirm-btn-ok" style="background:#1abc9c" onclick="${a.onclick}; closeActionPopup()">${a.label}</button>`
    ).join('') + '</div>' +
    '<div class="confirm-modal-buttons" style="margin-top:10px"><button class="confirm-btn-cancel" style="flex:1" onclick="closeActionPopup()">Avbryt</button></div>';
    popup.classList.add('active');
}

function closeActionPopup(e) {
    if (e && e.target !== document.getElementById('action-popup')) return;
    document.getElementById('action-popup').classList.remove('active');
}

function showSaveMenu() {
    showActionPopup('Lagre skjema', [
        { label: 'Lagre', onclick: 'saveForm()' },
        { label: 'Lagre som mal', onclick: 'saveAsTemplate()' }
    ]);
}

// Keep old names for compatibility
function closeSaveMenu() { closeActionPopup(); }
function closeExportMenu() { closeActionPopup(); }
function showExportMenu() {
    showActionPopup('Eksporter som', [
        { label: 'PDF', onclick: 'exportPDF()' },
        { label: 'JPG', onclick: 'exportJPG()' }
    ]);
}

function filterSavedForms() {
    const searchTerm = document.getElementById('saved-search').value.toLowerCase();
    const items = document.querySelectorAll('#saved-list .saved-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
    });
}

function filterArchivedForms() {
    const searchTerm = document.getElementById('archive-search').value.toLowerCase();
    const items = document.querySelectorAll('#archive-list .saved-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(searchTerm) ? 'flex' : 'none';
    });
}

function archiveForm(event, index) {
    event.stopPropagation();
    showConfirmModal('Vil du arkivere dette skjemaet?', async function() {
        const form = loadedForms[index];
        if (!form) return;

        if (currentUser && db) {
            try {
                // Flytt fra forms til archive
                await db.collection('users').doc(currentUser.uid).collection('archive').doc(form.id).set(form);
                await db.collection('users').doc(currentUser.uid).collection('forms').doc(form.id).delete();
            } catch (e) {
                console.error('Archive error:', e);
            }
        } else {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            const archived = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
            const f = saved.splice(index, 1)[0];
            archived.unshift(f);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
            localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archived));
        }

        showSavedForms();
        showNotificationModal('Skjema arkivert!', true);
    }, 'Arkiver', '#1abc9c');
}

// Cache for archived forms
let loadedArchivedForms = [];

async function showArchivedForms() {
    const listEl = document.getElementById('archive-list');
    listEl.innerHTML = '<div class="no-saved">Laster...</div>';
    document.getElementById('saved-modal').classList.add('active');
    switchHentTab('archived');

    const archived = await getArchivedForms();
    loadedArchivedForms = archived;

    if (archived.length === 0) {
        listEl.innerHTML = '<div class="no-saved">Ingen arkiverte skjemaer</div>';
    } else {
        listEl.innerHTML = archived.map((item, index) => {
            const prosjektnavn = item.prosjektnavn || '';
            const ordrenr = item.ordreseddelNr || '';
            const oppdragsgiver = item.oppdragsgiver || '';
            const dato = item.dato || '';
            const prosjektnr = item.prosjektnr || '';

            const row1 = [prosjektnavn, oppdragsgiver].filter(x => x).join(' • ') || 'Uten navn';
            const row2 = [dato, prosjektnr].filter(x => x).join(' • ');
            const row3 = ordrenr ? `Ordre: ${ordrenr}` : '';

            return `
                <div class="saved-item" onclick="loadArchivedForm(${index})">
                    <div class="saved-item-info">
                        <div class="saved-item-row1">${row1}</div>
                        ${row2 ? `<div class="saved-item-row2">${row2}</div>` : ''}
                        ${row3 ? `<div class="saved-item-row3">${row3}</div>` : ''}
                    </div>
                    <div class="saved-item-buttons">
                        <button class="saved-item-icon-btn restore" onclick="restoreForm(event, ${index})" title="Gjenopprett"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg></button>
                        <button class="saved-item-icon-btn delete" onclick="deleteArchivedForm(event, ${index})" title="Slett"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function loadArchivedForm(index) {
    if (loadedArchivedForms[index]) {
        setFormData(loadedArchivedForms[index]);
        lastSavedData = getFormDataSnapshot();
        closeArchiveModal();
    }
}

function restoreForm(event, index) {
    event.stopPropagation();
    showConfirmModal('Vil du gjenopprette dette skjemaet?', async function() {
        const form = loadedArchivedForms[index];
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

        showArchivedForms();
        showNotificationModal('Skjema gjenopprettet!', true);
    }, 'Gjenopprett', '#3498db');
}

function deleteArchivedForm(event, index) {
    event.stopPropagation();
    showConfirmModal('Er du sikker på at du vil slette dette skjemaet permanent?', async function() {
        const form = loadedArchivedForms[index];
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
        showArchivedForms();
    });
}

function closeArchiveModal() {
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
        showNotificationModal('Du må fylle inn prosjektnavn for å lagre som mal');
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
                showConfirmModal('En mal med prosjektnavn «' + templateData.prosjektnavn + '» finnes allerede. Vil du oppdatere den?', async function() {
                    await templatesRef.doc(existing.docs[0].id).set(templateData);
                    showNotificationModal('Mal oppdatert!', true);
                }, 'Oppdater', '#1abc9c');
            } else {
                const docId = Date.now().toString();
                await templatesRef.doc(docId).set(templateData);
                showNotificationModal('Prosjektmal lagret!', true);
            }
        } catch (e) {
            console.error('Save template error:', e);
            showNotificationModal('Feil ved lagring av mal: ' + e.message);
        }
    } else {
        // localStorage fallback
        const templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        const existingIndex = templates.findIndex(t => t.prosjektnavn.toLowerCase() === templateData.prosjektnavn.toLowerCase());

        if (existingIndex !== -1) {
            showConfirmModal('En mal med prosjektnavn «' + templateData.prosjektnavn + '» finnes allerede. Vil du oppdatere den?', function() {
                templateData.id = templates[existingIndex].id;
                templates[existingIndex] = templateData;
                localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
                showNotificationModal('Mal oppdatert!', true);
            }, 'Oppdater', '#1abc9c');
        } else {
            templateData.id = Date.now().toString();
            templates.push(templateData);
            localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
            showNotificationModal('Prosjektmal lagret!', true);
        }
    }
}

async function showTemplateModal() {
    const listEl = document.getElementById('template-list');
    listEl.innerHTML = '<div class="no-saved">Laster...</div>';
    document.getElementById('template-modal').classList.add('active');

    const templates = await getTemplates();
    loadedTemplates = templates;

    if (templates.length === 0) {
        listEl.innerHTML = '<div class="no-saved">Ingen prosjektmaler</div>';
    } else {
        listEl.innerHTML = templates.map((item, index) => {
            const row1 = item.prosjektnavn || 'Uten navn';
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
    showConfirmModal('Er du sikker på at du vil slette denne malen?', async function() {
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
        autoFillOrderNumber();
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
        showNotificationModal('Legg til minst ett nummerområde.');
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
    showNotificationModal('Innstillinger lagret!', true);
    closeSettingsModal();
}

async function showSettingsModal() {
    const settings = await getOrderNrSettings();
    settingsRanges = (settings && settings.ranges) ? settings.ranges.slice() : [];
    renderSettingsRanges();
    document.getElementById('settings-new-start').value = '';
    document.getElementById('settings-new-end').value = '';
    document.getElementById('settings-modal').classList.add('active');
    updateSettingsStatus();
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
}

function renderSettingsRanges() {
    const container = document.getElementById('settings-ranges');
    if (settingsRanges.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">Ingen nummerområder lagt til</div>';
        return;
    }
    container.innerHTML = settingsRanges.map((r, idx) =>
        `<div class="settings-range-item">
            <span>${r.start} – ${r.end}</span>
            <button onclick="removeSettingsRange(${idx})" title="Fjern"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
        </div>`
    ).join('');
}

async function addSettingsRange() {
    const startInput = document.getElementById('settings-new-start');
    const endInput = document.getElementById('settings-new-end');
    const start = parseInt(startInput.value);
    const end = parseInt(endInput.value);

    if (isNaN(start) || isNaN(end) || start > end) {
        showNotificationModal('"Fra" må være mindre enn eller lik "Til".');
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
    showNotificationModal('Nummerområde lagt til!', true);
}

function removeSettingsRange(idx) {
    const r = settingsRanges[idx];
    showConfirmModal(`Fjerne nummerområde ${r.start} – ${r.end}?`, async function() {
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
    statusEl.textContent = `Brukt: ${usedCount} av ${total}` + (nextNr ? ` · Neste: ${nextNr}` : ' · Alle brukt!');
}

async function getUsedOrderNumbers() {
    const saved = await getSavedForms();
    const archived = await getArchivedForms();
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
        showConfirmModal('Vil du starte et nytt skjema? Ulagrede endringer vil gå tapt.', doNewForm, 'Start ny', '#1abc9c');
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

async function exportPDF() {
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
        alert('Feil ved generering av PDF: ' + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function exportJPG() {
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
        alert('Feil ved generering av JPG: ' + error.message);
    } finally {
        loading.classList.remove('active');
    }
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
            if (data.oppdragsgiver || data.prosjektnavn || data.prosjektnr) {
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
});
