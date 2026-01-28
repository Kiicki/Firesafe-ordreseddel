const STORAGE_KEY = 'firesafe_ordresedler';
const ARCHIVE_KEY = 'firesafe_arkiv';

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
                showNotificationModal('Du er nå logget ut');
            });
        }, 'Logg ut', '#6c757d');
    } else {
        // Logg inn med Google
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider)
            .then((result) => {
                showNotificationModal('Logget inn som ' + result.user.email);
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

// Notification modal
function showNotificationModal(message) {
    document.getElementById('notification-modal-text').textContent = message;
    document.getElementById('notification-modal').classList.add('active');
}

function closeNotificationModal() {
    document.getElementById('notification-modal').classList.remove('active');
}

// Fullskjerm tekst-editor
let currentEditingField = null;

function openTextEditor(inputElement, label) {
    currentEditingField = inputElement;
    document.getElementById('text-editor-textarea').value = inputElement.value;
    document.getElementById('text-editor-title').textContent = label;
    document.getElementById('text-editor-modal').classList.add('active');
    document.getElementById('text-editor-textarea').focus();
}

function closeTextEditor() {
    if (currentEditingField) {
        currentEditingField.value = document.getElementById('text-editor-textarea').value;
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

// Check if we're on mobile
function isMobile() {
    return window.innerWidth <= 600;
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

// Apply auto-resize to all textareas in work-lines
function initAutoResize() {
    document.querySelectorAll('.work-description, .work-material').forEach(textarea => {
        textarea.addEventListener('input', function() {
            autoResizeTextarea(this);
        });
        // Initial resize
        autoResizeTextarea(textarea);
    });
}

// Force resize all textareas (used before export)
function resizeAllTextareas() {
    document.querySelectorAll('.work-description, .work-material').forEach(textarea => {
        const text = textarea.value;
        if (text && text.length > 0) {
            // First set a minimal height to force scrollHeight to calculate wrapped content
            textarea.style.height = '1px';
            textarea.style.overflow = 'hidden';

            // Force browser to recalculate layout
            void textarea.offsetHeight;

            // Now scrollHeight contains the full height needed for wrapped text
            const scrollHeight = textarea.scrollHeight;
            const minHeight = textarea.classList.contains('work-material') ? 18 : 24;
            textarea.style.height = Math.max(scrollHeight, minHeight) + 'px';
        } else {
            // Empty textarea - set to min height
            const minHeight = textarea.classList.contains('work-material') ? 18 : 24;
            textarea.style.height = minHeight + 'px';
        }
    });
}

// Convert textareas to divs for export (divs wrap text properly)
function convertTextareasToDiv() {
    const convertedElements = [];

    // Convert work description and material textareas
    document.querySelectorAll('#form-container .work-description, #form-container .work-material').forEach(textarea => {
        const div = document.createElement('div');
        div.textContent = textarea.value;
        div.className = textarea.className + ' textarea-converted';

        textarea.style.display = 'none';
        textarea.parentNode.insertBefore(div, textarea.nextSibling);
        convertedElements.push({ original: textarea, replacement: div });
    });

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

// Update delete button states based on visible lines
function updateDeleteButtonStates() {
    const visibleLines = document.querySelectorAll('#mobile-work-lines .mobile-work-line.visible');
    const allButtons = document.querySelectorAll('#mobile-work-lines .mobile-work-line-remove');

    // If only one line is visible, disable all delete buttons
    // Otherwise, enable delete buttons on visible lines
    allButtons.forEach((btn, index) => {
        const line = btn.closest('.mobile-work-line');
        if (visibleLines.length <= 1) {
            btn.disabled = true;
        } else if (line.classList.contains('visible')) {
            btn.disabled = false;
        }
    });
}

// Add another mobile work line (show next hidden line)
function addMobileLine() {
    const lines = document.querySelectorAll('#mobile-work-lines .mobile-work-line');
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].classList.contains('visible')) {
            lines[i].classList.add('visible');
            // Hide button if all 15 lines are visible
            if (i === lines.length - 1) {
                document.querySelector('.mobile-add-line-btn').style.display = 'none';
            }
            // Scroll to the new line
            lines[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
        }
    }
    // Update delete button states
    updateDeleteButtonStates();
}

// Remove a mobile work line
function removeMobileLine(button) {
    showConfirmModal('Er du sikker på at du vil fjerne denne linjen?', function() {
        const line = button.closest('.mobile-work-line');

        // Clear all inputs in this line
        line.querySelectorAll('input').forEach(input => input.value = '');

        // Hide the line
        line.classList.remove('visible');

        // Show the add button again
        document.querySelector('.mobile-add-line-btn').style.display = 'block';

        // Update delete button states
        updateDeleteButtonStates();

        // Sync to original form
        syncMobileToOriginal();

        // Save to session storage
        sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    });
}

// Show mobile lines that have data
function showMobileLinesWithData() {
    const lines = document.querySelectorAll('#mobile-work-lines .mobile-work-line');

    // Først nullstill alle linjer (fjern visible-klassen)
    lines.forEach(line => line.classList.remove('visible'));

    // Vis kun linjer med data
    lines.forEach(line => {
        const desc = line.querySelector('.mobile-work-desc');
        const material = line.querySelector('.mobile-work-material');
        const antall = line.querySelector('.mobile-work-antall');
        const enhet = line.querySelector('.mobile-work-enhet');

        if ((desc && desc.value) || (material && material.value) || (antall && antall.value) || (enhet && enhet.value)) {
            line.classList.add('visible');
        }
    });

    // Vis alltid minst første linjen
    if (!lines[0].classList.contains('visible')) {
        lines[0].classList.add('visible');
    }

    // Update button visibility
    const allVisible = Array.from(lines).every(l => l.classList.contains('visible'));
    document.querySelector('.mobile-add-line-btn').style.display = allVisible ? 'none' : 'block';

    // Update delete button states
    updateDeleteButtonStates();
}

// Sync mobile form to original form
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

    // Work lines
    const mobileWorkLines = document.querySelectorAll('#mobile-work-lines .mobile-work-line');
    const originalWorkLines = document.querySelectorAll('#work-lines .work-line');

    mobileWorkLines.forEach((mobileLine, index) => {
        if (originalWorkLines[index]) {
            const mobileDesc = mobileLine.querySelector('.mobile-work-desc');
            const mobileMaterial = mobileLine.querySelector('.mobile-work-material');
            const mobileAntall = mobileLine.querySelector('.mobile-work-antall');
            const mobileEnhet = mobileLine.querySelector('.mobile-work-enhet');

            const originalDesc = originalWorkLines[index].querySelector('.work-description');
            const originalMaterial = originalWorkLines[index].querySelector('.work-material');
            const originalAntall = originalWorkLines[index].querySelector('.work-antall');
            const originalEnhet = originalWorkLines[index].querySelector('.work-enhet');

            if (mobileDesc && originalDesc) {
                originalDesc.value = mobileDesc.value;
                autoResizeTextarea(originalDesc);
            }
            if (mobileMaterial && originalMaterial) {
                originalMaterial.value = mobileMaterial.value;
                autoResizeTextarea(originalMaterial);
            }
            if (mobileAntall && originalAntall) originalAntall.value = mobileAntall.value;
            if (mobileEnhet && originalEnhet) originalEnhet.value = mobileEnhet.value;
        }
    });
}

// Sync original form to mobile form
function syncOriginalToMobile() {
    // Simple fields
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

    // Work lines
    const originalWorkLines = document.querySelectorAll('#work-lines .work-line');
    const mobileWorkLines = document.querySelectorAll('#mobile-work-lines .mobile-work-line');

    originalWorkLines.forEach((originalLine, index) => {
        if (mobileWorkLines[index]) {
            const originalDesc = originalLine.querySelector('.work-description');
            const originalMaterial = originalLine.querySelector('.work-material');
            const originalAntall = originalLine.querySelector('.work-antall');
            const originalEnhet = originalLine.querySelector('.work-enhet');

            const mobileDesc = mobileWorkLines[index].querySelector('.mobile-work-desc');
            const mobileMaterial = mobileWorkLines[index].querySelector('.mobile-work-material');
            const mobileAntall = mobileWorkLines[index].querySelector('.mobile-work-antall');
            const mobileEnhet = mobileWorkLines[index].querySelector('.mobile-work-enhet');

            if (originalDesc && mobileDesc) mobileDesc.value = originalDesc.value;
            if (originalMaterial && mobileMaterial) mobileMaterial.value = originalMaterial.value;
            if (originalAntall && mobileAntall) mobileAntall.value = originalAntall.value;
            if (originalEnhet && mobileEnhet) mobileEnhet.value = originalEnhet.value;
        }
    });
}



function getFormData() {
    // If on mobile, sync to original first
    if (isMobile()) {
        syncMobileToOriginal();
    }

    const workLines = [];
    document.querySelectorAll('.work-line').forEach(line => {
        const description = line.querySelector('.work-description').value;
        const material = line.querySelector('.work-material').value;
        const antall = line.querySelector('.work-antall').value;
        const enhet = line.querySelector('.work-enhet').value;

        // Kun lagre linjer som har innhold
        if (description || material || antall || enhet) {
            workLines.push({ description, material, antall, enhet });
        }
    });

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
        workLines: workLines,
        sted: document.getElementById('sted').value,
        signeringDato: document.getElementById('signering-dato').value,
        kundensUnderskrift: document.getElementById('kundens-underskrift').value,
        savedAt: new Date().toISOString()
    };
}

function setFormData(data) {
    // Set original form data
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

    const workLines = document.querySelectorAll('.work-line');
    workLines.forEach((line, index) => {
        const lineData = data.workLines && data.workLines[index] ? data.workLines[index] : {};
        const descEl = line.querySelector('.work-description');
        const matEl = line.querySelector('.work-material');
        descEl.value = lineData.description || '';
        matEl.value = lineData.material || '';
        line.querySelector('.work-antall').value = lineData.antall || '';
        line.querySelector('.work-enhet').value = lineData.enhet || '';
        // Resize textareas
        autoResizeTextarea(descEl);
        autoResizeTextarea(matEl);
    });

    // Also sync to mobile form
    syncOriginalToMobile();

    // Show mobile lines that have data
    showMobileLinesWithData();
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

    // Sjekk at alle synlige linjer har beskrivelse
    const visibleLines = document.querySelectorAll('.mobile-work-line.visible');
    for (let i = 0; i < visibleLines.length; i++) {
        const desc = visibleLines[i].querySelector('.mobile-work-desc').value.trim();
        if (!desc) {
            showNotificationModal('Beskrivelse mangler for Linje ' + (i + 1));
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

            if (!existing.empty) {
                showConfirmModal('Dette ordrenummeret finnes allerede. Vil du oppdatere det?', async function() {
                    await formsRef.doc(existing.docs[0].id).set(data);
                    showNotificationModal('Skjema oppdatert!');
                }, 'Oppdater', '#1abc9c');
            } else {
                showConfirmModal('Er du sikker på at du vil lagre skjemaet?', async function() {
                    data.id = Date.now().toString();
                    await formsRef.doc(data.id).set(data);
                    showNotificationModal('Skjema lagret!');
                }, 'Lagre', '#1abc9c');
            }
        } catch (e) {
            console.error('Firestore save error:', e);
            showNotificationModal('Feil ved lagring: ' + e.message);
        }
    } else {
        // Fallback til localStorage
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const existingIndex = saved.findIndex(item =>
            item.ordreseddelNr === data.ordreseddelNr
        );

        if (existingIndex !== -1) {
            showConfirmModal('Dette ordrenummeret finnes allerede. Vil du oppdatere det?', function() {
                data.id = saved[existingIndex].id;
                saved[existingIndex] = data;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
                showNotificationModal('Skjema oppdatert!');
            }, 'Oppdater', '#1abc9c');
        } else {
            showConfirmModal('Er du sikker på at du vil lagre skjemaet?', function() {
                data.id = Date.now().toString();
                saved.unshift(data);
                if (saved.length > 50) saved.pop();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
                showNotificationModal('Skjema lagret!');
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
        showNotificationModal('Skjema arkivert!');
    }, 'Arkiver', '#1abc9c');
}

// Cache for archived forms
let loadedArchivedForms = [];

async function showArchivedForms() {
    const listEl = document.getElementById('archive-list');
    listEl.innerHTML = '<div class="no-saved">Laster...</div>';
    document.getElementById('archive-modal').classList.add('active');

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
        showNotificationModal('Skjema gjenopprettet!');
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
    document.getElementById('archive-modal').classList.remove('active');
    document.getElementById('archive-search').value = '';
}

function newForm() {
    showConfirmModal('Vil du starte et nytt skjema? Ulagrede endringer vil gå tapt.', function() {
        // Clear all inputs in both forms
        document.querySelectorAll('#form-container input, #form-container textarea').forEach(el => el.value = '');
        document.querySelectorAll('#mobile-form input, #mobile-form textarea').forEach(el => el.value = '');

        // Clear sessionStorage so refresh doesn't restore data
        sessionStorage.removeItem('firesafe_current');

        // Reset mobile lines - only show first line
        const lines = document.querySelectorAll('#mobile-work-lines .mobile-work-line');
        lines.forEach((line, index) => {
            if (index === 0) {
                line.classList.add('visible');
            } else {
                line.classList.remove('visible');
            }
        });
        document.querySelector('.mobile-add-line-btn').style.display = 'block';

        // Update delete button states (disable when only 1 line)
        updateDeleteButtonStates();
    }, 'Start ny', '#1abc9c');
}

async function exportPDF() {
    if (!validateRequiredFields()) return;

    const loading = document.getElementById('loading');
    loading.classList.add('active');

    try {
        // Sync mobile form to original if on mobile
        if (isMobile()) {
            syncMobileToOriginal();
        }

        const element = document.getElementById('form-container');

        // Temporarily show form-container at full size for export
        const originalDisplay = element.style.display;
        const originalPosition = element.style.position;
        const originalLeft = element.style.left;
        const originalWidth = element.style.width;

        // First show element with proper width to calculate sizes
        element.style.display = 'block';
        element.style.width = '800px';
        element.style.visibility = 'hidden';
        element.style.position = 'fixed';
        element.style.top = '0';
        element.style.left = '0';

        // Wait for layout to be calculated
        await new Promise(resolve => requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        }));

        // Convert textareas to divs for proper text wrapping
        const convertedElements = convertTextareasToDiv();

        // Wait for conversion to take effect
        await new Promise(resolve => requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        }));

        // Now move off-screen for capture
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

        // Restore textareas
        restoreTextareas(convertedElements);

        // Restore original styles
        element.style.display = originalDisplay;
        element.style.position = originalPosition;
        element.style.left = originalLeft;
        element.style.width = originalWidth;
        element.style.visibility = '';
        element.style.top = '';

        // On mobile, hide it again
        if (isMobile()) {
            element.style.display = 'none';
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, imgWidth, imgHeight);

        const prosjektnr = document.getElementById('prosjektnr').value || 'ukjent';
        const dato = document.getElementById('dato').value.replace(/\./g, '-') || formatDate(new Date()).replace(/\./g, '-');
        pdf.save(`ordreseddel_${prosjektnr}_${dato}.pdf`);
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
        // Sync mobile form to original if on mobile
        if (isMobile()) {
            syncMobileToOriginal();
        }

        const element = document.getElementById('form-container');

        // Temporarily show form-container at full size for export
        const originalDisplay = element.style.display;
        const originalPosition = element.style.position;
        const originalLeft = element.style.left;
        const originalWidth = element.style.width;

        // First show element with proper width to calculate sizes
        element.style.display = 'block';
        element.style.width = '800px';
        element.style.visibility = 'hidden';
        element.style.position = 'fixed';
        element.style.top = '0';
        element.style.left = '0';

        // Wait for layout to be calculated
        await new Promise(resolve => requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        }));

        // Convert textareas to divs for proper text wrapping
        const convertedElements = convertTextareasToDiv();

        // Wait for conversion to take effect
        await new Promise(resolve => requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        }));

        // Now move off-screen for capture
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

        // Restore textareas
        restoreTextareas(convertedElements);

        // Restore original styles
        element.style.display = originalDisplay;
        element.style.position = originalPosition;
        element.style.left = originalLeft;
        element.style.width = originalWidth;
        element.style.visibility = '';
        element.style.top = '';

        // On mobile, hide it again
        if (isMobile()) {
            element.style.display = 'none';
        }

        const link = document.createElement('a');
        const prosjektnr = document.getElementById('prosjektnr').value || 'ukjent';
        const dato = document.getElementById('dato').value.replace(/\./g, '-') || formatDate(new Date()).replace(/\./g, '-');
        link.download = `ordreseddel_${prosjektnr}_${dato}.jpg`;
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

document.getElementById('archive-modal').addEventListener('click', function(e) {
    if (e.target === this) closeArchiveModal();
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
    // Alltid tøm signering-dato og kundens underskrift ved oppstart
    document.getElementById('signering-dato').value = '';
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-signering-dato').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';

    // Initialize auto-resize for textareas
    initAutoResize();

    // Update delete button states
    updateDeleteButtonStates();

    // Fullskjerm tekst-editor for beskrivelse og material felter
    document.querySelectorAll('.mobile-work-desc, .mobile-work-material').forEach(input => {
        input.setAttribute('readonly', true);
        input.addEventListener('click', function(e) {
            const line = this.closest('.mobile-work-line');
            const lineNum = line.querySelector('.mobile-work-line-header span').textContent;
            const fieldType = this.classList.contains('mobile-work-desc') ? 'Beskrivelse' : 'Material';
            openTextEditor(this, fieldType + ' - ' + lineNum);
        });
    });
});
