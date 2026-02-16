// Cache for loaded forms (to use with index-based functions)
// Use window scope to ensure consistency
if (!window.loadedForms) window.loadedForms = [];
if (!window.loadedExternalForms) window.loadedExternalForms = [];
var preNewFormData = null;

// Pagination cursors for "Load more"
var _savedLastDoc = null, _sentLastDoc = null, _savedHasMore = false, _sentHasMore = false;
var _extLastDoc = null, _extSentLastDoc = null, _extHasMore = false, _extSentHasMore = false;
var _templateLastDoc = null, _templateHasMore = false;

function resetPaginationState() {
    _savedLastDoc = null; _sentLastDoc = null;
    _savedHasMore = false; _sentHasMore = false;
    _extLastDoc = null; _extSentLastDoc = null;
    _extHasMore = false; _extSentHasMore = false;
    _templateLastDoc = null; _templateHasMore = false;
}

// Refresh data for the currently active view after auth completes
function refreshActiveView() {
    if (!currentUser || !db) return;
    if (document.body.classList.contains('saved-modal-open')) {
        Promise.all([getSavedForms(), getSentForms()]).then(function(results) {
            var savedResult = results[0], sentResult = results[1];
            _savedLastDoc = savedResult.lastDoc;
            _sentLastDoc = sentResult.lastDoc;
            _savedHasMore = savedResult.hasMore;
            _sentHasMore = sentResult.hasMore;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(savedResult.forms.slice(0, 50)));
            localStorage.setItem(ARCHIVE_KEY, JSON.stringify(sentResult.forms.slice(0, 50)));
            window.loadedForms = savedResult.forms.map(function(f) { return Object.assign({}, f, { _isSent: false }); })
                .concat(sentResult.forms.map(function(f) { return Object.assign({}, f, { _isSent: true }); }));
            if (document.body.classList.contains('saved-modal-open')) {
                renderSavedFormsList(window.loadedForms, false, _savedHasMore || _sentHasMore);
            }
        }).catch(function(e) { console.error('Refresh saved forms:', e); });
    } else if (document.body.classList.contains('template-modal-open')) {
        getTemplates().then(function(result) {
            _templateLastDoc = result.lastDoc;
            _templateHasMore = result.hasMore;
            window.loadedTemplates = result.forms;
            if (document.body.classList.contains('template-modal-open')) {
                var activeTemplates = result.forms.filter(function(t) { return t.active !== false; });
                renderTemplateList(activeTemplates, false, _templateHasMore);
            }
        }).catch(function(e) { console.error('Refresh templates:', e); });
    }
}

// Helper: format date with time
function formatDateWithTime(date) {
    if (!date) return '';
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${day}.${month}.${year}, ${hours}:${mins}`;
}

// View system: show one view, hide all others
function showView(viewId) {
    document.querySelectorAll('.view').forEach(function(v) {
        v.classList.remove('active');
    });
    document.getElementById(viewId).classList.add('active');
}

function closeAllModals() {
    var actionPopup = document.getElementById('action-popup');
    if (actionPopup) actionPopup.classList.remove('active');
    document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open');
    showView('view-form');
}

function isModalOpen() {
    return document.body.classList.contains('template-modal-open')
        || document.body.classList.contains('saved-modal-open')
        || document.body.classList.contains('settings-modal-open');
}

// Update toolbar button states based on current view
function updateToolbarState() {
    const isOnForm = !document.body.classList.contains('template-modal-open')
                  && !document.body.classList.contains('saved-modal-open')
                  && !document.body.classList.contains('settings-modal-open');

    const isSentForm = document.getElementById('sent-banner').style.display !== 'none';

    const saveBtn = document.querySelector('.btn-save');
    if (saveBtn) {
        // Disable if not on form, or if form is sent
        saveBtn.disabled = !isOnForm || isSentForm;
    }

    const exportBtn = document.querySelector('.btn-export');
    if (exportBtn) {
        exportBtn.disabled = !isOnForm;
    }
}

function _buildSavedItemHtml(item, index) {
    var ordrenr = item.ordreseddelNr || '';
    var dato = formatDateWithTime(item.savedAt);
    var isSent = item._isSent;
    var dot = '<span class="status-dot ' + (isSent ? 'sent' : 'saved') + '"></span>';
    var copyBtn = isSent
        ? '<button class="saved-item-action-btn copy disabled" title="' + t('duplicate_btn') + '">' + copyIcon + '</button>'
        : '<button class="saved-item-action-btn copy" title="' + t('duplicate_btn') + '">' + copyIcon + '</button>';
    var deleteBtn = isSent
        ? '<button class="saved-item-action-btn delete disabled" title="' + t('delete_btn') + '">' + deleteIcon + '</button>'
        : '<button class="saved-item-action-btn delete" title="' + t('delete_btn') + '">' + deleteIcon + '</button>';
    return '<div class="saved-item" data-index="' + index + '">' +
        '<div class="saved-item-info">' +
            '<div class="saved-item-row1">' + dot + (escapeHtml(ordrenr) || t('no_name')) + '</div>' +
            (dato ? '<div class="saved-item-date">' + escapeHtml(dato) + '</div>' : '') +
        '</div>' +
        '<div class="saved-item-buttons">' + copyBtn + deleteBtn + '</div>' +
    '</div>';
}

function renderSavedFormsList(forms, append, hasMore) {
    var listEl = document.getElementById('saved-list');
    // Remove existing "load more" button
    var existingBtn = listEl.querySelector('.load-more-btn');
    if (existingBtn) existingBtn.remove();

    if (!append) {
        if (!forms || forms.length === 0) {
            listEl.innerHTML = '<div class="no-saved">' + t('no_saved_forms') + '</div>';
            return;
        }
        window.loadedForms = forms;
        listEl.innerHTML = forms.map(function(item, i) { return _buildSavedItemHtml(item, i); }).join('');
    } else {
        var startIndex = window.loadedForms.length;
        window.loadedForms = window.loadedForms.concat(forms);
        var html = forms.map(function(item, i) { return _buildSavedItemHtml(item, startIndex + i); }).join('');
        listEl.insertAdjacentHTML('beforeend', html);
    }

    // Attach form data to DOM elements
    listEl.querySelectorAll('.saved-item').forEach(function(el, i) {
        el._formData = window.loadedForms[i];
    });

    // Add "Load more" button if there are more forms
    if (hasMore) {
        listEl.insertAdjacentHTML('beforeend', '<button class="load-more-btn" onclick="loadMoreSavedForms()">' + t('load_more') + '</button>');
    }
}

async function loadMoreSavedForms() {
    var btn = document.querySelector('#saved-list .load-more-btn');
    if (btn) btn.textContent = '...';
    var newForms = [];
    if (_savedHasMore && _savedLastDoc) {
        var result = await getSavedForms(_savedLastDoc);
        _savedLastDoc = result.lastDoc;
        _savedHasMore = result.hasMore;
        newForms = newForms.concat(result.forms.map(function(f) { return Object.assign({}, f, { _isSent: false }); }));
    }
    if (_sentHasMore && _sentLastDoc) {
        var result2 = await getSentForms(_sentLastDoc);
        _sentLastDoc = result2.lastDoc;
        _sentHasMore = result2.hasMore;
        newForms = newForms.concat(result2.forms.map(function(f) { return Object.assign({}, f, { _isSent: true }); }));
    }
    renderSavedFormsList(newForms, true, _savedHasMore || _sentHasMore);
}

function showSavedForms() {
    closeAllModals();
    if (window.location.hash !== '#hent') {
        window.location.hash = 'hent';
    }

    // Show cached data immediately
    const cachedSaved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const cachedSent = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
    const cachedForms = cachedSaved.map(f => ({ ...f, _isSent: false })).concat(cachedSent.map(f => ({ ...f, _isSent: true })));
    renderSavedFormsList(cachedForms);

    showView('saved-modal');
    document.body.classList.add('saved-modal-open');
    updateToolbarState();
    document.getElementById('saved-list').scrollTop = 0;
    document.getElementById('external-list').scrollTop = 0;

    switchHentTab(isExternalForm ? 'external' : 'own');

    // Refresh from Firestore in background
    if (currentUser && db) {
        Promise.all([getSavedForms(), getSentForms()]).then(function([savedResult, sentResult]) {
            _savedLastDoc = savedResult.lastDoc;
            _sentLastDoc = sentResult.lastDoc;
            _savedHasMore = savedResult.hasMore;
            _sentHasMore = sentResult.hasMore;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(savedResult.forms.slice(0, 50)));
            localStorage.setItem(ARCHIVE_KEY, JSON.stringify(sentResult.forms.slice(0, 50)));
            window.loadedForms = savedResult.forms.map(f => ({ ...f, _isSent: false })).concat(sentResult.forms.map(f => ({ ...f, _isSent: true })));
            // Only update if still on saved-modal
            if (document.body.classList.contains('saved-modal-open')) {
                renderSavedFormsList(window.loadedForms, false, _savedHasMore || _sentHasMore);
            }
        }).catch(function(e) { console.error('Refresh saved forms:', e); });
    }
}

function setFormReadOnly(readOnly) {
    // Disable all form fields
    const fields = document.querySelectorAll('#mobile-form input, #mobile-form textarea, #mobile-form select, #form-container input, #form-container textarea, #form-container select');
    fields.forEach(el => el.disabled = readOnly);

    // Disable save button
    document.querySelector('.btn-save').disabled = readOnly;

    // Show/hide sent banner
    document.getElementById('sent-banner').style.display = readOnly ? 'block' : 'none';

    // Disable signature editing
    const signaturePreview = document.getElementById('mobile-signature-preview');
    if (signaturePreview) {
        signaturePreview.style.pointerEvents = readOnly ? 'none' : '';
        signaturePreview.style.opacity = readOnly ? '0.6' : '';
    }

    // Disable "add order" button
    const addOrderBtn = document.querySelector('.mobile-add-line-btn');
    if (addOrderBtn) {
        addOrderBtn.disabled = readOnly;
        addOrderBtn.style.opacity = readOnly ? '0.5' : '';
    }

    // Disable all "delete order" buttons
    if (readOnly) {
        document.querySelectorAll('.mobile-order-header-delete').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.style.pointerEvents = 'none';
        });
    } else {
        document.querySelectorAll('.mobile-order-header-delete').forEach(btn => {
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
        });
        updateOrderDeleteStates();
    }

    // Disable all "add material" buttons
    document.querySelectorAll('.mobile-add-mat-btn').forEach(btn => {
        btn.disabled = readOnly;
        btn.style.opacity = readOnly ? '0.5' : '';
    });

    // Disable clicking on material rows to edit
    document.querySelectorAll('.mobile-material-row').forEach(row => {
        row.style.pointerEvents = readOnly ? 'none' : '';
    });
}

function loadForm(index) {
    if (window.loadedForms[index]) {
        loadFormDirect(window.loadedForms[index]);
    }
}

function loadFormDirect(formData) {
    if (!formData) return;
    setFormData(formData);
    lastSavedData = getFormDataSnapshot();
    const isSent = !!formData._isSent;
    setFormReadOnly(isSent);
    sessionStorage.setItem('firesafe_current_sent', isSent ? '1' : '');
    closeModal();
    // Set hash based on form type
    window.location.hash = isExternalForm ? 'ekstern' : 'skjema';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t(isExternalForm ? 'external_form_title' : 'form_title');
    window.scrollTo(0, 0);
}

async function duplicateForm(event, index) {
    if (event) event.stopPropagation();
    const form = window.loadedForms[index];
    if (!form) return;
    await duplicateFormDirect(form);
}

async function duplicateFormDirect(form) {
    if (!form) return;

    setFormData(form);
    // Tøm ordrenummer og sett nytt
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    isExternalForm = false;
    updateExternalBadge();
    autoFillOrderNumber();

    // Sett uke til nåværende
    const now = new Date();
    const week = 'Uke ' + getWeekNumber(now);
    document.getElementById('dato').value = week;
    document.getElementById('mobile-dato').value = week;

    // Sett signeringsdato til i dag
    const today = formatDate(now);
    document.getElementById('signering-dato').value = today;
    document.getElementById('mobile-signering-dato').value = today;

    // Tøm kundens underskrift
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    clearSignaturePreview();

    // Reset bestillinger til 1 tomt ordrekort
    const container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    container.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
    updateOrderDeleteStates();
    document.getElementById('work-lines').innerHTML = '';

    lastSavedData = null;
    setFormReadOnly(false);
    closeModal();
    // Duplicated form is always regular (not external)
    window.location.hash = 'skjema';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('form_title');
    window.scrollTo(0, 0);
    showNotificationModal(t('duplicated_success'), true);
}

function deleteForm(event, index) {
    if (event) event.stopPropagation();
    const form = window.loadedForms[index];
    if (!form) return;
    deleteFormDirect(form);
}

function deleteFormDirect(form) {
    if (!form) return;
    const isSent = form._isSent;
    const confirmMsg = isSent ? t('delete_sent_confirm') : t('delete_confirm');

    showConfirmModal(confirmMsg, async function() {
        const col = isSent ? 'archive' : 'forms';
        const lsKey = isSent ? ARCHIVE_KEY : STORAGE_KEY;

        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection(col).doc(form.id).delete();
            } catch (e) {
                console.error('Delete error:', e);
            }
        } else {
            const list = JSON.parse(localStorage.getItem(lsKey) || '[]');
            const idx = list.findIndex(f => f.id === form.id);
            if (idx !== -1) {
                list.splice(idx, 1);
                localStorage.setItem(lsKey, JSON.stringify(list));
            }
        }
        removeFromOrderNumberIndex(form.ordreseddelNr);
        showSavedForms();
    });
}

function closeModal() {
    showView('view-form');
    document.body.classList.remove('saved-modal-open');
    updateToolbarState();
    document.getElementById('saved-search').value = '';
    document.getElementById('external-search').value = '';
    // Reset to own tab
    switchHentTab('own');
    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);
}

function switchHentTab(tab) {
    const tabs = document.querySelectorAll('#saved-modal .modal-tab');
    tabs.forEach(t => t.classList.remove('active'));

    const savedList = document.getElementById('saved-list');
    const externalList = document.getElementById('external-list');
    const ownSearch = document.getElementById('own-search-wrap');
    const externalSearch = document.getElementById('external-search-wrap');

    savedList.style.display = 'none';
    externalList.style.display = 'none';
    ownSearch.style.display = 'none';
    externalSearch.style.display = 'none';

    if (tab === 'own') {
        tabs[0].classList.add('active');
        savedList.style.display = '';
        ownSearch.style.display = '';
        savedList.scrollTop = 0;
    } else if (tab === 'external') {
        tabs[1].classList.add('active');
        externalList.style.display = '';
        externalSearch.style.display = '';
        externalList.scrollTop = 0;
        loadExternalTab();
    }
}

// Action popup
function showItemMenu(event, type, index, isSent) {
    event.stopPropagation();
    var actions = [];
    var title = '';
    if (type === 'form') {
        var form = window.loadedForms[index];
        if (form) title = form.ordreseddelNr || '';
        if (isSent) {
            actions.push({ label: t('sent_banner_move'), onclick: 'moveToSaved(null, ' + index + ')' });
        } else {
            actions.push({ label: t('duplicate_btn'), onclick: 'duplicateForm(null, ' + index + ')' });
        }
        actions.push({ label: t('delete_btn'), onclick: 'deleteForm(null, ' + index + ')', disabled: isSent });
    } else if (type === 'external') {
        var extForm = window.loadedExternalForms[index];
        if (extForm) title = extForm.ordreseddelNr || '';
        actions.push({ label: t('delete_btn'), onclick: 'deleteExternalForm(null, ' + index + ')' });
    } else if (type === 'template') {
        var tmpl = window.loadedTemplates[index];
        if (tmpl) {
            title = [tmpl.prosjektnavn, tmpl.oppdragsgiver, tmpl.prosjektnr].filter(function(x) { return x; }).join(' • ');
        }
        actions.push({ label: t('duplicate_btn'), onclick: 'duplicateTemplate(' + index + ')' });
        actions.push({ label: t('delete_btn'), onclick: 'deleteTemplate(null, ' + index + ')' });
    }
    showActionPopup(title, actions);
}

function showActionPopup(title, actions) {
    const popup = document.getElementById('action-popup');
    var titleEl = document.getElementById('action-popup-title');
    titleEl.textContent = title;
    titleEl.style.display = title ? '' : 'none';
    const buttonsEl = document.getElementById('action-popup-buttons');
    buttonsEl.innerHTML = actions.map((a, i) =>
        `<div class="confirm-modal-buttons"${i > 0 ? ' style="margin-top:8px"' : ''}><button class="confirm-btn-ok" style="background:#2c3e50;flex:1${a.disabled ? ';opacity:0.4;pointer-events:none' : ''}" onclick="${a.onclick}; closeActionPopup()"${a.disabled ? ' disabled' : ''}>${a.label}</button></div>`
    ).join('') +
    '<div class="confirm-modal-buttons" style="margin-top:4px"><button class="confirm-btn-cancel" style="flex:1" onclick="closeActionPopup()">' + t('btn_cancel') + '</button></div>';
    popup.classList.add('active');
}

function closeActionPopup(e) {
    if (e && e.target !== document.getElementById('action-popup')) return;
    document.getElementById('action-popup').classList.remove('active');
}

function showSaveMenu() {
    if (isModalOpen()) return;
    saveForm();
}

function showExportMenu() {
    if (isModalOpen()) return;
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
            '<button class="confirm-btn-ok" style="background:#2c3e50" onclick="doExportPNG(); closeActionPopup()">PNG</button>' +
        '</div>';
    if (!isSent) {
        html += '<div style="font-size:12px;color:#888;margin:10px 0 4px;">' + t('export_and_mark_label') + '</div>' +
            '<div class="confirm-modal-buttons">' +
                '<button class="confirm-btn-ok" style="background:#E8501A" onclick="markAsSentAndExport(\'pdf\'); closeActionPopup()">PDF</button>' +
                '<button class="confirm-btn-ok" style="background:#E8501A" onclick="markAsSentAndExport(\'png\'); closeActionPopup()">PNG</button>' +
            '</div>';
    }
    html += '<div class="confirm-modal-buttons" style="margin-top:10px"><button class="confirm-btn-cancel" style="flex:1" onclick="closeActionPopup()">' + t('btn_cancel') + '</button></div>';
    buttonsEl.innerHTML = html;
    popup.classList.add('active');
}

var _filterTimeout = null;
var _savedFormsAll = null;
var _externalFormsAll = null;
var _templatesAll = null;
function filterList(listId, searchId) {
    clearTimeout(_filterTimeout);
    _filterTimeout = setTimeout(function() {
        var term = document.getElementById(searchId).value.toLowerCase().trim();
        // Determine which data array and render function to use
        if (listId === 'saved-list') {
            if (!_savedFormsAll) _savedFormsAll = window.loadedForms ? window.loadedForms.slice() : [];
            if (!term) { var all = _savedFormsAll; _savedFormsAll = null; renderSavedFormsList(all); return; }
            var filtered = _savedFormsAll.filter(function(f) {
                return (f.ordreseddelNr || '').toLowerCase().startsWith(term);
            });
            renderSavedFormsList(filtered);
        } else if (listId === 'external-list') {
            if (!_externalFormsAll) _externalFormsAll = window.loadedExternalForms ? window.loadedExternalForms.slice() : [];
            if (!term) { var all2 = _externalFormsAll; _externalFormsAll = null; renderExternalFormsList(all2); return; }
            var filtered2 = _externalFormsAll.filter(function(f) {
                return (f.ordreseddelNr || '').toLowerCase().startsWith(term);
            });
            renderExternalFormsList(filtered2);
        } else if (listId === 'template-list') {
            if (!_templatesAll) _templatesAll = window.loadedTemplates ? window.loadedTemplates.slice() : [];
            if (!term) { var all3 = _templatesAll; _templatesAll = null; renderTemplateList(all3); return; }
            var filtered3 = _templatesAll.filter(function(f) {
                return (f.prosjektnavn || '').toLowerCase().startsWith(term);
            });
            renderTemplateList(filtered3);
        }
    }, 150);
}

async function markAsSent() {
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value;
    if (!ordrenr) return;

    const formsCol = isExternalForm ? 'external' : 'forms';
    const archiveCol = isExternalForm ? 'externalArchive' : 'archive';
    const sKey = isExternalForm ? EXTERNAL_KEY : STORAGE_KEY;
    const aKey = isExternalForm ? EXTERNAL_ARCHIVE_KEY : ARCHIVE_KEY;

    if (currentUser && db) {
        // Use Firestore .where() to find the form directly (not paginated)
        try {
            var snap = await db.collection('users').doc(currentUser.uid).collection(formsCol).where('ordreseddelNr', '==', ordrenr).get();
            if (!snap.empty) {
                var form = Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
                await db.collection('users').doc(currentUser.uid).collection(archiveCol).doc(form.id).set(form);
                await db.collection('users').doc(currentUser.uid).collection(formsCol).doc(form.id).delete();
            } else {
                // Not saved yet — save directly to archive
                var data = getFormData();
                data.id = Date.now().toString();
                await db.collection('users').doc(currentUser.uid).collection(archiveCol).doc(data.id).set(data);
            }
        } catch (e) {
            console.error('Mark as sent error:', e);
        }
    } else {
        // localStorage path
        var localSaved = JSON.parse(localStorage.getItem(sKey) || '[]');
        var formIndex = localSaved.findIndex(function(f) { return f.ordreseddelNr === ordrenr; });
        if (formIndex !== -1) {
            var archived = JSON.parse(localStorage.getItem(aKey) || '[]');
            var f = localSaved.splice(formIndex, 1)[0];
            archived.unshift(f);
            localStorage.setItem(sKey, JSON.stringify(localSaved));
            localStorage.setItem(aKey, JSON.stringify(archived));
        } else {
            var data2 = getFormData();
            data2.id = Date.now().toString();
            var archived2 = JSON.parse(localStorage.getItem(aKey) || '[]');
            archived2.unshift(data2);
            localStorage.setItem(aKey, JSON.stringify(archived2));
        }
    }

    lastSavedData = getFormDataSnapshot();
    showNotificationModal(t('marked_as_sent'), true);
}

async function moveCurrentToSaved() {
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value;
    if (!ordrenr) return;

    const formsCol = isExternalForm ? 'external' : 'forms';
    const archiveCol = isExternalForm ? 'externalArchive' : 'archive';
    const sKey = isExternalForm ? EXTERNAL_KEY : STORAGE_KEY;
    const aKey = isExternalForm ? EXTERNAL_ARCHIVE_KEY : ARCHIVE_KEY;

    if (currentUser && db) {
        // Use Firestore .where() directly (not paginated)
        try {
            var snap = await db.collection('users').doc(currentUser.uid).collection(archiveCol).where('ordreseddelNr', '==', ordrenr).get();
            if (snap.empty) return;
            var form = Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
            await db.collection('users').doc(currentUser.uid).collection(formsCol).doc(form.id).set(form);
            await db.collection('users').doc(currentUser.uid).collection(archiveCol).doc(form.id).delete();
        } catch (e) {
            console.error('Move to saved error:', e);
        }
    } else {
        var archived = JSON.parse(localStorage.getItem(aKey) || '[]');
        var formIndex = archived.findIndex(function(f) { return f.ordreseddelNr === ordrenr; });
        if (formIndex === -1) return;
        var saved = JSON.parse(localStorage.getItem(sKey) || '[]');
        var f = archived.splice(formIndex, 1)[0];
        saved.unshift(f);
        localStorage.setItem(aKey, JSON.stringify(archived));
        localStorage.setItem(sKey, JSON.stringify(saved));
    }

    setFormReadOnly(false);
    showNotificationModal(t('move_to_saved_success'), true);
}

function moveToSaved(event, index) {
    if (event) event.stopPropagation();
    showConfirmModal(t('move_to_saved_confirm'), async function() {
        const form = window.loadedForms[index];
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
            const idx = archived.findIndex(f => f.id === form.id);
            if (idx !== -1) {
                const f = archived.splice(idx, 1)[0];
                saved.unshift(f);
                localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archived));
                localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
            }
        }

        // Hvis det åpne skjemaet er det som ble flyttet, fjern sendt-modus
        const currentOrdrenr = document.getElementById('mobile-ordreseddel-nr').value;
        if (currentOrdrenr && form.ordreseddelNr === currentOrdrenr) {
            setFormReadOnly(false);
        }

        showSavedForms();
        showNotificationModal(t('move_to_saved_success'), true);
    }, t('btn_move'), '#333');
}

// === External forms tab ===

function renderExternalFormsList(forms, append, hasMore) {
    var listEl = document.getElementById('external-list');
    var existingBtn = listEl.querySelector('.load-more-btn');
    if (existingBtn) existingBtn.remove();

    if (!append) {
        if (!forms || forms.length === 0) {
            listEl.innerHTML = '<div class="no-saved">' + t('no_external_forms') + '</div>';
            return;
        }
        window.loadedExternalForms = forms;
        listEl.innerHTML = forms.map(function(item, index) {
            var ordrenr = item.ordreseddelNr || '';
            var dato = formatDateWithTime(item.savedAt);
            var isSent = item._isSent;
            var dot = '<span class="status-dot ' + (isSent ? 'sent' : 'saved') + '"></span>';
            return '<div class="saved-item" data-index="' + index + '">' +
                '<div class="saved-item-info">' +
                    '<div class="saved-item-row1">' + dot + (escapeHtml(ordrenr) || t('no_name')) + '</div>' +
                    (dato ? '<div class="saved-item-date">' + escapeHtml(dato) + '</div>' : '') +
                '</div>' +
                '<div class="saved-item-buttons">' +
                    '<button class="saved-item-action-btn delete" title="' + t('delete_btn') + '">' + deleteIcon + '</button>' +
                '</div>' +
            '</div>';
        }).join('');
    } else {
        var startIndex = window.loadedExternalForms.length;
        window.loadedExternalForms = window.loadedExternalForms.concat(forms);
        var html = forms.map(function(item, i) {
            var idx = startIndex + i;
            var ordrenr = item.ordreseddelNr || '';
            var dato = formatDateWithTime(item.savedAt);
            var isSent = item._isSent;
            var dot = '<span class="status-dot ' + (isSent ? 'sent' : 'saved') + '"></span>';
            return '<div class="saved-item" data-index="' + idx + '">' +
                '<div class="saved-item-info">' +
                    '<div class="saved-item-row1">' + dot + (escapeHtml(ordrenr) || t('no_name')) + '</div>' +
                    (dato ? '<div class="saved-item-date">' + escapeHtml(dato) + '</div>' : '') +
                '</div>' +
                '<div class="saved-item-buttons">' +
                    '<button class="saved-item-action-btn delete" title="' + t('delete_btn') + '">' + deleteIcon + '</button>' +
                '</div>' +
            '</div>';
        }).join('');
        listEl.insertAdjacentHTML('beforeend', html);
    }

    listEl.querySelectorAll('.saved-item').forEach(function(el, i) {
        el._formData = window.loadedExternalForms[i];
    });

    if (hasMore) {
        listEl.insertAdjacentHTML('beforeend', '<button class="load-more-btn" onclick="loadMoreExternalForms()">' + t('load_more') + '</button>');
    }
}

async function loadMoreExternalForms() {
    var btn = document.querySelector('#external-list .load-more-btn');
    if (btn) btn.textContent = '...';
    var newForms = [];
    if (_extHasMore && _extLastDoc) {
        var result = await getExternalForms(_extLastDoc);
        _extLastDoc = result.lastDoc;
        _extHasMore = result.hasMore;
        newForms = newForms.concat(result.forms);
    }
    if (_extSentHasMore && _extSentLastDoc) {
        var result2 = await getExternalSentForms(_extSentLastDoc);
        _extSentLastDoc = result2.lastDoc;
        _extSentHasMore = result2.hasMore;
        newForms = newForms.concat(result2.forms.map(function(f) { return Object.assign({}, f, { _isSent: true }); }));
    }
    renderExternalFormsList(newForms, true, _extHasMore || _extSentHasMore);
}

async function loadExternalTab() {
    // Show cached data immediately
    const cachedForms = JSON.parse(localStorage.getItem(EXTERNAL_KEY) || '[]');
    const cachedSent = JSON.parse(localStorage.getItem(EXTERNAL_ARCHIVE_KEY) || '[]');
    const cached = cachedForms.concat(cachedSent.map(f => ({ ...f, _isSent: true })));
    renderExternalFormsList(cached);

    const extResult = await getExternalForms();
    const extSentResult = await getExternalSentForms();
    _extLastDoc = extResult.lastDoc;
    _extSentLastDoc = extSentResult.lastDoc;
    _extHasMore = extResult.hasMore;
    _extSentHasMore = extSentResult.hasMore;
    if (currentUser) {
        localStorage.setItem(EXTERNAL_KEY, JSON.stringify(extResult.forms.slice(0, 50)));
        localStorage.setItem(EXTERNAL_ARCHIVE_KEY, JSON.stringify(extSentResult.forms.slice(0, 50)));
    }
    window.loadedExternalForms = extResult.forms.concat(extSentResult.forms.map(f => ({ ...f, _isSent: true })));
    if (currentUser || window.loadedExternalForms.length > 0) {
        renderExternalFormsList(window.loadedExternalForms, false, _extHasMore || _extSentHasMore);
    }
}

function loadExternalForm(index) {
    const form = window.loadedExternalForms[index];
    if (!form) return;
    loadExternalFormDirect(form);
}

function loadExternalFormDirect(form) {
    if (!form) return;
    setFormData(form);
    lastSavedData = getFormDataSnapshot();
    const isSent = !!form._isSent;
    setFormReadOnly(isSent);
    sessionStorage.setItem('firesafe_current_sent', isSent ? '1' : '');
    closeModal();
    // External form = #ekstern
    window.location.hash = 'ekstern';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('external_form_title');
    window.scrollTo(0, 0);
}

function deleteExternalForm(event, index) {
    if (event) event.stopPropagation();
    const form = window.loadedExternalForms[index];
    if (!form) return;
    deleteExternalFormDirect(form);
}

function deleteExternalFormDirect(form) {
    if (!form) return;
    const isSent = form._isSent;
    const confirmMsg = isSent ? t('delete_sent_confirm') : t('delete_confirm');

    showConfirmModal(confirmMsg, async function() {
        const col = isSent ? 'externalArchive' : 'external';
        const lsKey = isSent ? EXTERNAL_ARCHIVE_KEY : EXTERNAL_KEY;

        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection(col).doc(form.id).delete();
            } catch (e) {
                console.error('Delete external error:', e);
            }
        } else {
            const list = JSON.parse(localStorage.getItem(lsKey) || '[]');
            const idx = list.findIndex(f => f.id === form.id);
            if (idx !== -1) {
                list.splice(idx, 1);
                localStorage.setItem(lsKey, JSON.stringify(list));
            }
        }
        loadExternalTab();
    });
}


// ============================================
// PROSJEKTMALER
// ============================================

if (!window.loadedTemplates) window.loadedTemplates = [];

async function getTemplates(lastDoc) {
    if (currentUser && db) {
        try {
            var q = db.collection('users').doc(currentUser.uid).collection('templates').orderBy('prosjektnavn').limit(PAGE_SIZE);
            if (lastDoc) q = q.startAfter(lastDoc);
            var snapshot = await q.get();
            return { forms: snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); }), lastDoc: snapshot.docs[snapshot.docs.length - 1] || null, hasMore: snapshot.docs.length === PAGE_SIZE };
        } catch (e) {
            console.error('Templates error:', e);
            return { forms: JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]'), lastDoc: null, hasMore: false };
        }
    }
    if (auth && !authReady) return { forms: [], lastDoc: null, hasMore: false };
    return { forms: JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]'), lastDoc: null, hasMore: false };
}

async function saveAsTemplate() {
    // Sync mobile to original first
    if (isMobile()) {
        syncMobileToOriginal();
    }

    // Validate template required fields
    const reqSettings = cachedRequiredSettings || getDefaultRequiredSettings();
    const templateReqs = reqSettings.template || {};
    const templateFieldMap = {
        prosjektnavn:   { id: 'prosjektnavn',  key: 'validation_prosjektnavn' },
        prosjektnr:     { id: 'prosjektnr',    key: 'validation_prosjektnr' },
        oppdragsgiver:  { id: 'oppdragsgiver', key: 'validation_oppdragsgiver' },
        kundensRef:     { id: 'kundens-ref',     key: 'validation_kundens_ref' },
        fakturaadresse: { id: 'fakturaadresse',  key: 'validation_fakturaadresse' }
    };
    for (const [settingKey, fieldInfo] of Object.entries(templateFieldMap)) {
        if (!templateReqs[settingKey]) continue;
        const el = document.getElementById(fieldInfo.id);
        if (!el || !el.value.trim()) {
            showNotificationModal(t('required_field', t(fieldInfo.key)));
            return;
        }
    }

    const templateData = {
        prosjektnavn: document.getElementById('prosjektnavn').value.trim(),
        prosjektnr: document.getElementById('prosjektnr').value.trim(),
        oppdragsgiver: document.getElementById('oppdragsgiver').value.trim(),
        kundensRef: document.getElementById('kundens-ref').value.trim(),
        fakturaadresse: document.getElementById('fakturaadresse').value.trim(),
        createdAt: new Date().toISOString(),
        createdBy: currentUser ? currentUser.uid : 'local'
    };

    if (currentUser && db) {
        try {
            const templatesRef = db.collection('users').doc(currentUser.uid).collection('templates');
            const docId = Date.now().toString();
            await templatesRef.doc(docId).set(templateData);
            showNotificationModal(t('template_save_success'), true);
        } catch (e) {
            console.error('Save template error:', e);
            showNotificationModal(t('template_save_error') + e.message);
        }
    } else {
        const templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        templateData.id = Date.now().toString();
        templates.push(templateData);
        localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
        showNotificationModal(t('template_save_success'), true);
    }
}

function _buildTemplateItemHtml(item, index) {
    var row1 = escapeHtml(item.prosjektnavn) || t('no_name');
    var row2 = [item.oppdragsgiver, item.prosjektnr].filter(function(x) { return x; }).map(escapeHtml).join(' \u2022 ');
    return '<div class="saved-item" data-index="' + index + '">' +
        '<div class="saved-item-info">' +
            '<div class="saved-item-row1">' + row1 + '</div>' +
            (row2 ? '<div class="saved-item-row2">' + row2 + '</div>' : '') +
        '</div>' +
        '<div class="saved-item-buttons">' +
            '<button class="saved-item-action-btn delete" title="' + t('delete_btn') + '">' + deleteIcon + '</button>' +
        '</div>' +
    '</div>';
}

function renderTemplateList(templates, append, hasMore) {
    var listEl = document.getElementById('template-list');
    var existingBtn = listEl.querySelector('.load-more-btn');
    if (existingBtn) existingBtn.remove();

    if (!append) {
        if (!templates || templates.length === 0) {
            listEl.innerHTML = '<div class="no-saved">' + t('no_templates') + '</div>';
            return;
        }
        window.loadedTemplates = templates;
        listEl.innerHTML = templates.map(function(item, i) { return _buildTemplateItemHtml(item, i); }).join('');
    } else {
        var startIndex = window.loadedTemplates.length;
        window.loadedTemplates = window.loadedTemplates.concat(templates);
        var html = templates.map(function(item, i) { return _buildTemplateItemHtml(item, startIndex + i); }).join('');
        listEl.insertAdjacentHTML('beforeend', html);
    }

    listEl.querySelectorAll('.saved-item').forEach(function(el, i) {
        el._formData = window.loadedTemplates[i];
    });

    if (hasMore) {
        listEl.insertAdjacentHTML('beforeend', '<button class="load-more-btn" onclick="loadMoreTemplates()">' + t('load_more') + '</button>');
    }
}

async function loadMoreTemplates() {
    var btn = document.querySelector('#template-list .load-more-btn');
    if (btn) btn.textContent = '...';
    if (_templateHasMore && _templateLastDoc) {
        var result = await getTemplates(_templateLastDoc);
        _templateLastDoc = result.lastDoc;
        _templateHasMore = result.hasMore;
        renderTemplateList(result.forms, true, _templateHasMore);
    }
}

function showTemplateModal() {
    closeAllModals();
    history.replaceState(null, '', window.location.pathname);

    // Show cached templates immediately (filter out deactivated)
    const cached = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]').filter(function(t) { return t.active !== false; });
    renderTemplateList(cached);

    showView('template-modal');
    document.body.classList.add('template-modal-open');
    updateToolbarState();

    // Refresh from Firestore in background
    if (currentUser && db) {
        getTemplates().then(function(result) {
            _templateLastDoc = result.lastDoc;
            _templateHasMore = result.hasMore;
            localStorage.setItem(TEMPLATE_KEY, JSON.stringify(result.forms.slice(0, 50)));
            // Only update if still on template-modal (filter out deactivated)
            if (document.body.classList.contains('template-modal-open')) {
                var activeTemplates = result.forms.filter(function(t) { return t.active !== false; });
                renderTemplateList(activeTemplates, false, _templateHasMore);
            }
        }).catch(function(e) { console.error('Refresh templates:', e); });
    }
}

function autoFillOrderNumber() {
    const nextNr = getNextOrderNumber();
    if (nextNr !== null) {
        document.getElementById('ordreseddel-nr').value = nextNr;
        document.getElementById('mobile-ordreseddel-nr').value = nextNr;
    }
}

function loadTemplate(index) {
    const template = window.loadedTemplates[index];
    if (!template) return;
    loadTemplateDirect(template);
}

function loadTemplateDirect(template) {
    if (!template) return;

    preNewFormData = null;
    clearForm();
    setFormReadOnly(false);

    // Fill defaults first, then override with template values
    autoFillDefaults();

    // Template values override defaults (only non-empty, project fields only)
    const templateFields = {
        'oppdragsgiver': template.oppdragsgiver,
        'prosjektnr': template.prosjektnr,
        'prosjektnavn': template.prosjektnavn,
        'kundens-ref': template.kundensRef,
        'fakturaadresse': template.fakturaadresse
    };
    for (const [id, val] of Object.entries(templateFields)) {
        if (val) {
            const el = document.getElementById(id);
            const mobileEl = document.getElementById('mobile-' + id);
            if (el) el.value = val;
            if (mobileEl) mobileEl.value = val;
        }
    }

    autoFillOrderNumber();

    showView('view-form');
    document.body.classList.remove('template-modal-open');
    updateToolbarState();
    document.getElementById('template-search').value = '';
    window.location.hash = 'skjema';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    document.getElementById('form-header-title').textContent = t('form_title');
    updateOrderDeleteStates();
    window.scrollTo(0, 0);
}

function deleteTemplate(event, index) {
    if (event) event.stopPropagation();
    const template = window.loadedTemplates[index];
    if (!template) return;
    deleteTemplateDirect(template);
}

function deleteTemplateDirect(template) {
    if (!template) return;
    showConfirmModal(t('template_delete_confirm'), async function() {
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

async function duplicateTemplate(index) {
    const template = window.loadedTemplates[index];
    if (!template) return;

    const copy = Object.assign({}, template);
    copy.prosjektnavn = (copy.prosjektnavn || '') + ' (kopi)';
    copy.createdAt = new Date().toISOString();

    if (currentUser && db) {
        try {
            const docId = Date.now().toString();
            copy.id = docId;
            await db.collection('users').doc(currentUser.uid).collection('templates').doc(docId).set(copy);
        } catch (e) {
            console.error('Duplicate template error:', e);
            showNotificationModal(t('template_save_error') + e.message);
            return;
        }
    } else {
        copy.id = Date.now().toString();
        const templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        templates.push(copy);
        localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
    }
    showNotificationModal(t('duplicated_success'), true);
    showTemplateModal();
}

function closeTemplateModal() {
    clearForm();
    preNewFormData = null;
    setFormReadOnly(false);
    autoFillOrderNumber();
    autoFillDefaults();

    showView('view-form');
    document.body.classList.remove('template-modal-open');
    updateToolbarState();
    document.getElementById('template-search').value = '';
    window.location.hash = 'skjema';
    document.getElementById('form-header-title').textContent = t('form_title');
    updateOrderDeleteStates();
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
}


// ============================================
// ORDRESEDDELNUMMER INNSTILLINGER
// ============================================

// In-memory ranges for settings modal editing
let settingsRanges = [];
let settingsGivenAway = [];

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
    if (data && !data.givenAway) data.givenAway = [];
    return data;
}

async function syncSettingsToLocal() {
    if (!db || !currentUser) return;
    try {
        const doc = await db.collection('users').doc(currentUser.uid)
            .collection('settings').doc('ordrenr').get();
        if (doc.exists) {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(doc.data()));
        }
    } catch (e) { /* localStorage-cache brukes som fallback */ }
}

function buildOrderNrSettings() {
    return { ranges: settingsRanges.slice(), givenAway: settingsGivenAway.slice() };
}

function getSettingsPageTitle(page) {
    const titles = {
        ordrenr: t('settings_ordrenr'),
        fields: t('settings_fields'),
        templates: t('settings_templates'),
        language: t('settings_language'),
        materials: t('settings_materials')
    };
    return titles[page] || '';
}

function showSettingsModal() {
    closeAllModals();
    window.location.hash = 'settings';
    showSettingsMenu();
    showView('settings-modal');
    document.body.classList.add('settings-modal-open');
    updateToolbarState();
}

function closeSettingsModal() {
    showView('view-form');
    document.body.classList.remove('settings-modal-open');
    updateToolbarState();
    showSettingsMenu();
    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);
}

function showSettingsMenu() {
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    document.getElementById('settings-page-menu').style.display = 'block';
    document.getElementById('settings-header-title').textContent = t('settings_title');
    document.body.classList.remove('settings-subpage-open');
    const header = document.getElementById('settings-header');
    const existingBack = header.querySelector('.settings-back-btn');
    if (existingBack) existingBack.remove();
}

async function showSettingsPage(page) {
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    document.getElementById('settings-page-' + page).style.display = 'block';
    document.getElementById('settings-header-title').textContent = getSettingsPageTitle(page);
    document.body.classList.add('settings-subpage-open');

    const header = document.getElementById('settings-header');
    if (!header.querySelector('.settings-back-btn')) {
        const backBtn = document.createElement('button');
        backBtn.className = 'settings-back-btn';
        backBtn.innerHTML = '&lsaquo;';
        backBtn.onclick = showSettingsMenu;
        header.insertBefore(backBtn, header.firstChild);
    }

    // Mark global settings pages as read-only for non-admins
    var pageEl = document.getElementById('settings-page-' + page);
    if (page === 'materials' && !isAdmin) {
        pageEl.classList.add('settings-readonly');
    } else {
        pageEl.classList.remove('settings-readonly');
    }

    if (page === 'ordrenr') {
        const settings = await getOrderNrSettings();
        settingsRanges = (settings && settings.ranges) ? settings.ranges.slice() : [];
        settingsGivenAway = (settings && settings.givenAway) ? settings.givenAway.slice() : [];
        renderSettingsRanges();
        renderGivenAwayRanges();
        document.getElementById('settings-new-start').value = '';
        document.getElementById('settings-new-end').value = '';
        document.getElementById('settings-give-start').value = '';
        document.getElementById('settings-give-end').value = '';
        updateSettingsStatus();
    } else if (page === 'fields') {
        await renderFieldSettings();
    } else if (page === 'language') {
        document.getElementById('lang-check-no').textContent = currentLang === 'no' ? '\u2713' : '';
        document.getElementById('lang-check-en').textContent = currentLang === 'en' ? '\u2713' : '';
    } else if (page === 'templates') {
        await renderSettingsTemplateList();
    } else if (page === 'materials') {
        await loadMaterialSettingsToModal();
    }
}

// ============================================
// MATERIALER OG ENHETER INNSTILLINGER
// ============================================

let settingsMaterials = [];
let settingsUnits = [];

function normalizeMaterialData(data) {
    if (!data) return { materials: [], units: [] };
    let materials = data.materials || [];
    if (materials.length > 0 && typeof materials[0] === 'string') {
        materials = materials.map(name => ({ name: name, needsSpec: false }));
    }
    return { materials, units: data.units || [] };
}

async function getMaterialSettings() {
    if (currentUser && db) {
        try {
            const doc = await db.collection('settings').doc('materials').get();
            if (doc.exists) return normalizeMaterialData(doc.data());
        } catch (e) {
            console.error('Materials settings error:', e);
        }
    }
    const stored = localStorage.getItem(MATERIALS_KEY);
    return normalizeMaterialData(stored ? JSON.parse(stored) : null);
}

async function saveMaterialSettings() {
    if (!isAdmin) return;
    const data = { materials: settingsMaterials.map(m => ({ name: m.name, needsSpec: !!m.needsSpec })), units: settingsUnits.slice() };
    if (currentUser && db) {
        try {
            await db.collection('settings').doc('materials').set(data);
        } catch (e) {
            console.error('Save materials settings error:', e);
        }
    }
    localStorage.setItem(MATERIALS_KEY, JSON.stringify(data));
    // Refresh dropdown cache
    cachedMaterialOptions = data.materials.slice();
    cachedUnitOptions = settingsUnits.slice();
}

async function loadMaterialSettingsToModal() {
    const data = await getMaterialSettings();
    settingsMaterials = (data && data.materials) ? data.materials.slice() : [];
    settingsUnits = (data && data.units) ? data.units.slice() : [];
    settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    sortAlpha(settingsUnits);
    renderMaterialSettingsItems();
    renderUnitSettingsItems();
    document.getElementById('settings-new-material').value = '';
    document.getElementById('settings-new-unit').value = '';
}

function renderMaterialSettingsItems() {
    const container = document.getElementById('settings-material-items');
    if (settingsMaterials.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_materials') + '</div>';
        return;
    }
    container.innerHTML = settingsMaterials.map((item, idx) =>
        `<div class="settings-list-item"><span onclick="editSettingsMaterial(${idx})">${escapeHtml(item.name)}</span><button class="settings-spec-toggle${item.needsSpec ? ' active' : ''}" onclick="toggleMaterialSpec(${idx})" title="${t('settings_spec_toggle')}">Spec</button><button class="settings-delete-btn" onclick="removeSettingsMaterial(${idx})" title="${t('btn_remove')}">${deleteIcon}</button></div>`
    ).join('');
}

function renderUnitSettingsItems() {
    const container = document.getElementById('settings-unit-items');
    if (settingsUnits.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_units') + '</div>';
        return;
    }
    container.innerHTML = settingsUnits.map((item, idx) =>
        `<div class="settings-list-item"><span onclick="editSettingsUnit(${idx})">${escapeHtml(item)}</span><button class="settings-delete-btn" onclick="removeSettingsUnit(${idx})" title="${t('btn_remove')}">${deleteIcon}</button></div>`
    ).join('');
}

function toggleSettingsSection(section) {
    const body = document.getElementById('settings-body-' + section);
    const arrow = document.getElementById('settings-arrow-' + section);
    body.classList.toggle('open');
    arrow.classList.toggle('open');
}

async function addSettingsMaterial() {
    if (!isAdmin) return;
    const input = document.getElementById('settings-new-material');
    const val = input.value.trim();
    if (!val) return;
    if (settingsMaterials.some(m => m.name.toLowerCase() === val.toLowerCase())) {
        showNotificationModal(t('settings_material_exists'));
        return;
    }
    settingsMaterials.push({ name: val, needsSpec: false });
    settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    input.value = '';
    renderMaterialSettingsItems();
    await saveMaterialSettings();
    showNotificationModal(t('settings_material_added'), true);
}

async function addSettingsUnit() {
    if (!isAdmin) return;
    const input = document.getElementById('settings-new-unit');
    const val = input.value.trim();
    if (!val) return;
    if (settingsUnits.some(u => u.toLowerCase() === val.toLowerCase())) {
        showNotificationModal(t('settings_unit_exists'));
        return;
    }
    settingsUnits.push(val);
    sortAlpha(settingsUnits);
    input.value = '';
    renderUnitSettingsItems();
    await saveMaterialSettings();
    showNotificationModal(t('settings_unit_added'), true);
}

function removeSettingsMaterial(idx) {
    if (!isAdmin) return;
    const item = settingsMaterials[idx];
    showConfirmModal(t('settings_material_remove', item.name), async function() {
        settingsMaterials.splice(idx, 1);
        renderMaterialSettingsItems();
        await saveMaterialSettings();
    });
}

function removeSettingsUnit(idx) {
    if (!isAdmin) return;
    const item = settingsUnits[idx];
    showConfirmModal(t('settings_material_remove', item), async function() {
        settingsUnits.splice(idx, 1);
        renderUnitSettingsItems();
        await saveMaterialSettings();
    });
}

function editSettingsMaterial(idx) {
    if (!isAdmin) return;
    const container = document.getElementById('settings-material-items');
    const item = container.children[idx];
    const span = item.querySelector('span');
    const oldVal = settingsMaterials[idx].name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-list-edit-input';
    input.value = oldVal;
    span.replaceWith(input);
    input.focus();
    input.select();
    let saved = false;
    async function save() {
        if (saved) return;
        saved = true;
        const newVal = input.value.trim();
        if (!newVal || newVal === oldVal) {
            renderMaterialSettingsItems();
            return;
        }
        if (settingsMaterials.some((m, i) => i !== idx && m.name.toLowerCase() === newVal.toLowerCase())) {
            showNotificationModal(t('settings_material_exists'));
            renderMaterialSettingsItems();
            return;
        }
        settingsMaterials[idx].name = newVal;
        settingsMaterials.sort((a, b) => a.name.localeCompare(b.name, 'no'));
        renderMaterialSettingsItems();
        await saveMaterialSettings();
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { saved = true; renderMaterialSettingsItems(); }
    });
}

async function toggleMaterialSpec(idx) {
    if (!isAdmin) return;
    settingsMaterials[idx].needsSpec = !settingsMaterials[idx].needsSpec;
    renderMaterialSettingsItems();
    await saveMaterialSettings();
}

function editSettingsUnit(idx) {
    if (!isAdmin) return;
    const container = document.getElementById('settings-unit-items');
    const item = container.children[idx];
    const span = item.querySelector('span');
    const oldVal = settingsUnits[idx];
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-list-edit-input';
    input.value = oldVal;
    span.replaceWith(input);
    input.focus();
    input.select();
    let saved = false;
    async function save() {
        if (saved) return;
        saved = true;
        const newVal = input.value.trim();
        if (!newVal || newVal === oldVal) {
            renderUnitSettingsItems();
            return;
        }
        if (settingsUnits.some((u, i) => i !== idx && u.toLowerCase() === newVal.toLowerCase())) {
            showNotificationModal(t('settings_unit_exists'));
            renderUnitSettingsItems();
            return;
        }
        settingsUnits[idx] = newVal;
        sortAlpha(settingsUnits);
        renderUnitSettingsItems();
        await saveMaterialSettings();
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { saved = true; renderUnitSettingsItems(); }
    });
}

// ============================================
// DROPDOWN FOR MATERIALE OG ENHET
// ============================================

// Cache for dropdown options
let cachedMaterialOptions = null;
let cachedUnitOptions = null;

async function getDropdownOptions() {
    const data = await getMaterialSettings();
    cachedMaterialOptions = (data && data.materials) ? data.materials : [];
    cachedUnitOptions = (data && data.units) ? data.units : [];
    cachedMaterialOptions.sort((a, b) => a.name.localeCompare(b.name, 'no'));
    sortAlpha(cachedUnitOptions);
    // Cache to localStorage for offline use
    localStorage.setItem(MATERIALS_KEY, JSON.stringify({ materials: cachedMaterialOptions, units: cachedUnitOptions }));
}


// ============================================
// OBLIGATORISKE FELT INNSTILLINGER
// ============================================

function getDefaultRequiredSettings() {
    return {
        save: {
            ordreseddelNr: true,
            dato: true,
            oppdragsgiver: true,
            kundensRef: false,
            fakturaadresse: false,
            prosjektnr: true,
            prosjektnavn: true,
            montor: true,
            avdeling: true,
            sted: true,
            signeringDato: true,
            beskrivelse: true,
            signatur: false
        },
        template: {
            prosjektnavn: true,
            prosjektnr: false,
            oppdragsgiver: false,
            kundensRef: false,
            fakturaadresse: false
        }
    };
}

const REQUIRED_FIELD_LABELS = {
    save: [
        { key: 'ordreseddelNr',  labelKey: 'label_ordreseddel_nr' },
        { key: 'dato',           labelKey: 'label_uke' },
        { key: 'oppdragsgiver',  labelKey: 'label_oppdragsgiver' },
        { key: 'kundensRef',     labelKey: 'label_kundens_ref' },
        { key: 'fakturaadresse', labelKey: 'label_fakturaadresse' },
        { key: 'prosjektnr',     labelKey: 'label_prosjektnr' },
        { key: 'prosjektnavn',   labelKey: 'label_prosjektnavn' },
        { key: 'montor',         labelKey: 'label_montor' },
        { key: 'avdeling',       labelKey: 'label_avdeling' },
        { key: 'sted',           labelKey: 'label_sted' },
        { key: 'signeringDato',  labelKey: 'label_dato' },
        { key: 'beskrivelse',    labelKey: 'settings_req_beskrivelse' },
        { key: 'signatur',       labelKey: 'label_kundens_underskrift' }
    ],
    template: [
        { key: 'prosjektnavn',   labelKey: 'label_prosjektnavn' },
        { key: 'prosjektnr',     labelKey: 'label_prosjektnr' },
        { key: 'oppdragsgiver',  labelKey: 'label_oppdragsgiver' },
        { key: 'kundensRef',     labelKey: 'label_kundens_ref' },
        { key: 'fakturaadresse', labelKey: 'label_fakturaadresse' }
    ]
};

const REQUIRED_FIELD_IDS = {
    ordreseddelNr:  'mobile-ordreseddel-nr',
    dato:           'mobile-dato',
    oppdragsgiver:  'mobile-oppdragsgiver',
    kundensRef:     'mobile-kundens-ref',
    fakturaadresse: 'mobile-fakturaadresse',
    prosjektnr:     'mobile-prosjektnr',
    prosjektnavn:   'mobile-prosjektnavn',
    montor:         'mobile-montor',
    avdeling:       'mobile-avdeling',
    sted:           'mobile-sted',
    signeringDato:  'mobile-signering-dato'
};

async function getRequiredSettings() {
    if (currentUser && db) {
        try {
            const doc = await db.collection('settings').doc('required').get();
            if (doc.exists) {
                const data = doc.data();
                const defaults = getDefaultRequiredSettings();
                return {
                    save: { ...defaults.save, ...(data.save || {}) },
                    template: { ...defaults.template, ...(data.template || {}) }
                };
            }
        } catch (e) {
            console.error('Required settings error:', e);
        }
    }
    const stored = localStorage.getItem(REQUIRED_KEY);
    if (stored) {
        try {
            const data = JSON.parse(stored);
            const defaults = getDefaultRequiredSettings();
            return {
                save: { ...defaults.save, ...(data.save || {}) },
                template: { ...defaults.template, ...(data.template || {}) }
            };
        } catch (e) {}
    }
    return getDefaultRequiredSettings();
}

async function saveRequiredSettings(data) {
    if (!isAdmin) return;
    if (currentUser && db) {
        try {
            await db.collection('settings').doc('required').set(data);
        } catch (e) {
            console.error('Save required settings error:', e);
        }
    }
    localStorage.setItem(REQUIRED_KEY, JSON.stringify(data));
    cachedRequiredSettings = data;
    updateRequiredIndicators();
}

async function loadRequiredSettingsToModal() {
    const data = await getRequiredSettings();
    cachedRequiredSettings = data;
    renderRequiredSettingsItems('save');
    renderRequiredSettingsItems('template');
}

function renderRequiredSettingsItems(section) {
    const container = document.getElementById('settings-fields-' + section + '-items');
    if (!container) return;

    const fields = REQUIRED_FIELD_LABELS[section];
    const settings = cachedRequiredSettings || getDefaultRequiredSettings();
    const sectionSettings = settings[section] || {};

    container.innerHTML = fields.map(function(field) {
        const isOn = sectionSettings[field.key] !== false;

        return '<div class="settings-toggle-item">' +
            '<span>' + escapeHtml(t(field.labelKey)) + '</span>' +
            '<label class="settings-toggle">' +
            '<input type="checkbox" data-section="' + section + '" data-key="' + field.key + '"' +
            (isOn ? ' checked' : '') + (!isAdmin ? ' disabled' : '') +
            ' onchange="toggleRequiredField(\'' + section + '\', \'' + field.key + '\', this.checked)">' +
            '<span class="settings-toggle-slider"></span>' +
            '</label>' +
            '</div>';
    }).join('');
}

async function toggleRequiredField(section, key, value) {
    if (!isAdmin) return;
    const settings = cachedRequiredSettings || getDefaultRequiredSettings();
    if (!settings[section]) settings[section] = {};
    settings[section][key] = value;
    await saveRequiredSettings(settings);
}

// ============================================
// FELTINNSTILLINGER (KOMBINERT SIDE)
// ============================================

async function renderFieldSettings() {
    const defaults = await getDefaultSettings();
    const reqSettings = await getRequiredSettings();
    cachedRequiredSettings = reqSettings;

    // Fill default value inputs
    DEFAULT_FIELDS.forEach(function(field) {
        var input = document.getElementById('default-' + field);
        if (input) {
            input.value = defaults[field] || '';
            defaultsInitialValues[field] = input.value;
        }
    });

    // Render template required toggles
    renderRequiredSettingsItems('template');

    // Render save required toggles
    renderRequiredSettingsItems('save');

    // Re-initialize defaults auto-save
    defaultsAutoSaveInitialized = false;
    initDefaultsAutoSave();
}

// ============================================
// MAL-ADMINISTRASJON I INNSTILLINGER
// ============================================

var _editingTemplateId = null;

async function renderSettingsTemplateList() {
    var listEl = document.getElementById('settings-template-list');
    if (!listEl) return;

    var templates = [];
    if (currentUser && db) {
        try {
            var snapshot = await db.collection('users').doc(currentUser.uid).collection('templates').orderBy('prosjektnavn').get();
            templates = snapshot.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
        } catch (e) {
            console.error('Load templates for settings:', e);
            templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        }
    } else {
        templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
    }

    if (!templates || templates.length === 0) {
        listEl.innerHTML = '<div class="no-saved">' + t('no_templates_settings') + '</div>';
        return;
    }

    listEl.innerHTML = templates.map(function(tpl) {
        var isInactive = tpl.active === false;
        var name = escapeHtml(tpl.prosjektnavn) || t('no_name');
        var detail = [tpl.oppdragsgiver, tpl.prosjektnr].filter(function(x) { return x; }).map(escapeHtml).join(' \u2022 ');

        return '<div class="settings-template-item' + (isInactive ? ' inactive' : '') + '" data-id="' + escapeHtml(tpl.id) + '">' +
            '<div class="settings-template-item-row1">' + name +
                (isInactive ? ' <span class="settings-template-item-badge">' + t('settings_template_inactive') + '</span>' : '') +
            '</div>' +
            (detail ? '<div class="settings-template-item-row2">' + detail + '</div>' : '') +
            '<div class="settings-template-actions">' +
                '<button onclick="showTemplateEditor(\'' + escapeHtml(tpl.id) + '\')">' + t('edit_btn') + '</button>' +
                '<button onclick="toggleTemplateActive(\'' + escapeHtml(tpl.id) + '\')">' +
                    (isInactive ? t('settings_template_activate') : t('settings_template_deactivate')) +
                '</button>' +
                '<button class="btn-delete" onclick="deleteTemplateFromSettings(\'' + escapeHtml(tpl.id) + '\')">' + t('delete_btn') + '</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

function showTemplateEditor(templateId) {
    _editingTemplateId = templateId || null;
    var overlay = document.getElementById('template-editor-overlay');
    var titleEl = document.getElementById('template-editor-title');

    // Clear fields
    document.getElementById('tpl-edit-prosjektnavn').value = '';
    document.getElementById('tpl-edit-prosjektnr').value = '';
    document.getElementById('tpl-edit-oppdragsgiver').value = '';
    document.getElementById('tpl-edit-kundensRef').value = '';
    document.getElementById('tpl-edit-fakturaadresse').value = '';

    if (templateId) {
        titleEl.textContent = t('settings_edit_template');
        // Find template and fill fields
        _findTemplateById(templateId).then(function(tpl) {
            if (tpl) {
                document.getElementById('tpl-edit-prosjektnavn').value = tpl.prosjektnavn || '';
                document.getElementById('tpl-edit-prosjektnr').value = tpl.prosjektnr || '';
                document.getElementById('tpl-edit-oppdragsgiver').value = tpl.oppdragsgiver || '';
                document.getElementById('tpl-edit-kundensRef').value = tpl.kundensRef || '';
                document.getElementById('tpl-edit-fakturaadresse').value = tpl.fakturaadresse || '';
            }
        });
    } else {
        titleEl.textContent = t('settings_new_template');
    }

    overlay.classList.add('active');
}

function closeTemplateEditor() {
    _editingTemplateId = null;
    document.getElementById('template-editor-overlay').classList.remove('active');
}

async function _findTemplateById(id) {
    if (currentUser && db) {
        try {
            var doc = await db.collection('users').doc(currentUser.uid).collection('templates').doc(id).get();
            if (doc.exists) return Object.assign({ id: doc.id }, doc.data());
        } catch (e) {
            console.error('Find template error:', e);
        }
    }
    var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
    return templates.find(function(t) { return t.id === id; }) || null;
}

async function saveTemplateFromEditor() {
    var data = {
        prosjektnavn: document.getElementById('tpl-edit-prosjektnavn').value.trim(),
        prosjektnr: document.getElementById('tpl-edit-prosjektnr').value.trim(),
        oppdragsgiver: document.getElementById('tpl-edit-oppdragsgiver').value.trim(),
        kundensRef: document.getElementById('tpl-edit-kundensRef').value.trim(),
        fakturaadresse: document.getElementById('tpl-edit-fakturaadresse').value.trim()
    };

    // Require at least prosjektnavn
    if (!data.prosjektnavn) {
        showNotificationModal(t('required_field', t('validation_prosjektnavn')));
        return;
    }

    if (_editingTemplateId) {
        // Update existing template
        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection('templates').doc(_editingTemplateId).update(data);
            } catch (e) {
                console.error('Update template error:', e);
                showNotificationModal(t('template_save_error') + e.message);
                return;
            }
        } else {
            var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
            var idx = templates.findIndex(function(t) { return t.id === _editingTemplateId; });
            if (idx !== -1) {
                Object.assign(templates[idx], data);
                localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
            }
        }
        showNotificationModal(t('template_updated'), true);
    } else {
        // Create new template
        data.createdAt = new Date().toISOString();
        data.createdBy = currentUser ? currentUser.uid : 'local';
        data.active = true;

        if (currentUser && db) {
            try {
                var docId = Date.now().toString();
                await db.collection('users').doc(currentUser.uid).collection('templates').doc(docId).set(data);
            } catch (e) {
                console.error('Create template error:', e);
                showNotificationModal(t('template_save_error') + e.message);
                return;
            }
        } else {
            data.id = Date.now().toString();
            var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
            templates.push(data);
            localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
        }
        showNotificationModal(t('template_save_success'), true);
    }

    closeTemplateEditor();
    await renderSettingsTemplateList();
}

async function toggleTemplateActive(templateId) {
    var tpl = await _findTemplateById(templateId);
    if (!tpl) return;

    var newActive = tpl.active === false ? true : false;

    if (currentUser && db) {
        try {
            await db.collection('users').doc(currentUser.uid).collection('templates').doc(templateId).update({ active: newActive });
        } catch (e) {
            console.error('Toggle template error:', e);
            return;
        }
    } else {
        var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
        var idx = templates.findIndex(function(t) { return t.id === templateId; });
        if (idx !== -1) {
            templates[idx].active = newActive;
            localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
        }
    }

    await renderSettingsTemplateList();
}

function deleteTemplateFromSettings(templateId) {
    showConfirmModal(t('template_delete_confirm'), async function() {
        if (currentUser && db) {
            try {
                await db.collection('users').doc(currentUser.uid).collection('templates').doc(templateId).delete();
            } catch (e) {
                console.error('Delete template error:', e);
                return;
            }
        } else {
            var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
            var idx = templates.findIndex(function(t) { return t.id === templateId; });
            if (idx !== -1) {
                templates.splice(idx, 1);
                localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
            }
        }
        await renderSettingsTemplateList();
    });
}

function updateRequiredIndicators() {
    const settings = cachedRequiredSettings || getDefaultRequiredSettings();
    const saveReqs = settings.save || {};

    // Update text input fields
    for (const [key, inputId] of Object.entries(REQUIRED_FIELD_IDS)) {
        const input = document.getElementById(inputId);
        if (!input) continue;
        const field = input.closest('.mobile-field');
        if (!field) continue;

        if (saveReqs[key]) {
            field.classList.add('field-required');
        } else {
            field.classList.remove('field-required');
        }
    }

    // Order description fields (dynamic order cards)
    document.querySelectorAll('#mobile-orders .mobile-order-desc').forEach(function(desc) {
        const field = desc.closest('.mobile-field');
        if (!field) return;
        if (saveReqs.beskrivelse !== false) {
            field.classList.add('field-required');
        } else {
            field.classList.remove('field-required');
        }
    });

    // Signature field
    const sigPreview = document.getElementById('mobile-signature-preview');
    if (sigPreview) {
        const sigField = sigPreview.closest('.mobile-field');
        if (sigField) {
            if (saveReqs.signatur) {
                sigField.classList.add('field-required');
            } else {
                sigField.classList.remove('field-required');
            }
        }
    }
}

// ============================================
// STANDARDVERDIER (AUTOFYLL)
// ============================================

const DEFAULT_FIELDS = ['montor', 'avdeling', 'sted'];

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

async function syncDefaultsToLocal() {
    if (!db || !currentUser) return;
    try {
        const doc = await db.collection('users').doc(currentUser.uid)
            .collection('settings').doc('defaults').get();
        if (doc.exists) {
            localStorage.setItem(DEFAULTS_KEY, JSON.stringify(doc.data()));
        }
    } catch (e) { /* localStorage-cache brukes som fallback */ }
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
}

// Auto-save defaults on blur
let defaultsInitialValues = {};
let defaultsAutoSaveInitialized = false;

function initDefaultsAutoSave() {
    if (defaultsAutoSaveInitialized) return;
    defaultsAutoSaveInitialized = true;

    DEFAULT_FIELDS.forEach(field => {
        const input = document.getElementById('default-' + field);
        if (input) {
            input.addEventListener('blur', async function() {
                const newVal = this.value.trim();
                if (newVal !== defaultsInitialValues[field]) {
                    defaultsInitialValues[field] = newVal;
                    await saveDefaultSettings();
                    showNotificationModal(t('settings_defaults_saved'), true);
                }
            });
        }
    });
}

async function loadDefaultSettingsToModal() {
    const defaults = await getDefaultSettings();
    DEFAULT_FIELDS.forEach(field => {
        const input = document.getElementById('default-' + field);
        input.value = defaults[field] || '';
        defaultsInitialValues[field] = input.value;
    });
    initDefaultsAutoSave();
}

function autoFillDefaults() {
    // Use localStorage cache for instant response
    const stored = localStorage.getItem(DEFAULTS_KEY);
    const defaults = stored ? JSON.parse(stored) : {};
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
    const countEl = document.getElementById('settings-count-ranges');
    if (settingsRanges.length === 0) {
        container.innerHTML = '<div style="font-size:13px;color:#999;margin-bottom:8px;">' + t('settings_no_ranges') + '</div>';
        if (countEl) countEl.textContent = '';
        return;
    }
    container.innerHTML = settingsRanges.map((r, idx) =>
        `<div class="settings-range-item">
            <span>${escapeHtml(String(r.start))} – ${escapeHtml(String(r.end))}</span>
            <button onclick="removeSettingsRange(${idx})" title="${t('btn_remove')}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
        </div>`
    ).join('');
    if (countEl) {
        let total = 0;
        settingsRanges.forEach(r => { total += r.end - r.start + 1; });
        countEl.textContent = '(' + settingsRanges.length + (settingsRanges.length === 1 ? ' serie, ' : ' serier, ') + total + ' nr)';
    }
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
    const settings = buildOrderNrSettings();
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
        const settings = buildOrderNrSettings();
        if (currentUser && db) {
            try { await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings); } catch (e) {}
        }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
}

function renderGivenAwayRanges() {
    const container = document.getElementById('settings-given-away');
    const countEl = document.getElementById('settings-count-giveaway');
    if (!container) return;
    if (settingsGivenAway.length === 0) {
        container.innerHTML = '';
        if (countEl) countEl.textContent = '';
        return;
    }
    container.innerHTML = settingsGivenAway.map((r, idx) =>
        `<div class="settings-range-item settings-given-item">
            <span>${r.start === r.end ? escapeHtml(String(r.start)) : escapeHtml(String(r.start)) + ' – ' + escapeHtml(String(r.end))}</span>
            <button onclick="removeGivenAway(${idx})" title="${t('btn_remove')}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
        </div>`
    ).join('');
    if (countEl) {
        let total = 0;
        settingsGivenAway.forEach(r => { total += r.end - r.start + 1; });
        countEl.textContent = '(' + total + ' nr)';
    }
}

async function addGivenAwayRange() {
    const startInput = document.getElementById('settings-give-start');
    const endInput = document.getElementById('settings-give-end');
    const start = parseInt(startInput.value);
    const end = endInput.value.trim() === '' ? start : parseInt(endInput.value);

    if (isNaN(start) || isNaN(end) || start > end) {
        showNotificationModal(t('settings_range_error'));
        return;
    }
    // Must be within an existing range
    if (!isNumberInRanges(start, settingsRanges) || !isNumberInRanges(end, settingsRanges)) {
        showNotificationModal(t('settings_give_not_in_range'));
        return;
    }
    // Check overlap with already given-away
    const overlapsGiven = settingsGivenAway.some(r => start <= r.end && end >= r.start);
    if (overlapsGiven) {
        showNotificationModal(t('settings_give_overlap'));
        return;
    }
    // Check if any numbers are already used (saved/sent)
    const usedNumbers = getUsedOrderNumbers();
    for (let n = start; n <= end; n++) {
        if (usedNumbers.has(String(n))) {
            showNotificationModal(t('settings_give_already_used', n));
            return;
        }
    }
    settingsGivenAway.push({ start, end });
    settingsGivenAway.sort((a, b) => a.start - b.start);
    startInput.value = '';
    endInput.value = '';
    renderGivenAwayRanges();
    updateSettingsStatus();
    // Auto-save
    const settings = buildOrderNrSettings();
    if (currentUser && db) {
        try { await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings); } catch (e) {}
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    showNotificationModal(t('settings_give_added'), true);
}

function removeGivenAway(idx) {
    const r = settingsGivenAway[idx];
    const label = r.start === r.end ? String(r.start) : r.start + ' – ' + r.end;
    showConfirmModal(t('settings_give_remove', label), async function() {
        settingsGivenAway.splice(idx, 1);
        renderGivenAwayRanges();
        updateSettingsStatus();
        // Auto-save
        const settings = buildOrderNrSettings();
        if (currentUser && db) {
            try { await db.collection('users').doc(currentUser.uid).collection('settings').doc('ordrenr').set(settings); } catch (e) {}
        }
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
}

function getGivenAwayNumbers() {
    const given = new Set();
    settingsGivenAway.forEach(r => {
        for (let n = r.start; n <= r.end; n++) given.add(String(n));
    });
    return given;
}

async function updateSettingsStatus() {
    const statusEl = document.getElementById('settings-status');
    if (settingsRanges.length === 0) {
        statusEl.textContent = '';
        return;
    }

    let total = 0;
    settingsRanges.forEach(r => { total += r.end - r.start + 1; });

    const usedNumbers = getUsedOrderNumbers();
    const givenNumbers = getGivenAwayNumbers();
    let usedCount = 0;
    let givenCount = 0;
    settingsRanges.forEach(r => {
        for (let n = r.start; n <= r.end; n++) {
            if (givenNumbers.has(String(n))) givenCount++;
            else if (usedNumbers.has(String(n))) usedCount++;
        }
    });

    // Merge given into used for "next" calculation
    const allUnavailable = new Set([...usedNumbers, ...givenNumbers]);
    const nextNr = findNextInRanges(settingsRanges, allUnavailable);
    let statusText = t('settings_used', usedCount, total);
    if (givenCount > 0) statusText += ' · ' + t('settings_given_away_count', givenCount);
    statusText += nextNr ? ' · ' + t('settings_next', nextNr) : ' · ' + t('settings_all_used');
    statusEl.textContent = statusText;
}

function getUsedOrderNumbers() {
    return new Set(JSON.parse(localStorage.getItem(USED_NUMBERS_KEY) || '[]'));
}

function findNextInRanges(ranges, usedNumbers) {
    for (const r of ranges) {
        for (let n = r.start; n <= r.end; n++) {
            if (!usedNumbers.has(String(n))) return n;
        }
    }
    return null;
}

function getNextOrderNumber() {
    // Use localStorage cache for instant response
    const stored = localStorage.getItem(SETTINGS_KEY);
    let data = stored ? JSON.parse(stored) : null;
    if (!data) return null;
    // Backward compat
    if (!data.ranges && data.nrStart != null) {
        data = { ranges: [{ start: data.nrStart, end: data.nrEnd }] };
    }
    if (!data.ranges || data.ranges.length === 0) return null;
    if (!data.givenAway) data.givenAway = [];

    const usedNumbers = getUsedOrderNumbers();
    data.givenAway.forEach(r => {
        for (let n = r.start; n <= r.end; n++) usedNumbers.add(String(n));
    });
    return findNextInRanges(data.ranges, usedNumbers);
}

function isNumberInRanges(nr, ranges) {
    const n = parseInt(nr, 10);
    if (isNaN(n)) return false;
    for (const r of ranges) {
        if (n >= r.start && n <= r.end) return true;
    }
    return false;
}

function updateExternalBadge() {
    const badge = document.getElementById('external-badge');
    if (badge) badge.style.display = isExternalForm ? '' : 'none';
}

function startExternalOrder() {
    showView('view-form');
    document.body.classList.remove('template-modal-open');
    updateToolbarState();
    document.getElementById('template-search').value = '';
    if (preNewFormData) {
        clearForm();
        preNewFormData = null;
        setFormReadOnly(false);
    }
    isExternalForm = true;
    updateExternalBadge();
    // External form = #ekstern
    window.location.hash = 'ekstern';
    sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    // Update form header title
    document.getElementById('form-header-title').textContent = t('external_form_title');
    updateOrderDeleteStates();
}

function hasAnyFormData() {
    // Hent standardverdier for sammenligning
    const defaults = JSON.parse(localStorage.getItem('firesafe_defaults') || '{}');

    // Felt som MÅ ha bruker-input (ikke standardverdier)
    const requiredFields = [
        { id: 'mobile-ordreseddel-nr', default: '' },
        { id: 'mobile-oppdragsgiver', default: defaults.oppdragsgiver || '' },
        { id: 'mobile-prosjektnr', default: defaults.prosjektnr || '' },
        { id: 'mobile-prosjektnavn', default: defaults.prosjektnavn || '' }
    ];

    for (const field of requiredFields) {
        const value = document.getElementById(field.id).value.trim();
        if (value && value !== field.default) return true;
    }

    // Sjekk orders - har de beskrivelse?
    const orderCards = document.querySelectorAll('#mobile-orders .mobile-order-card');
    for (const card of orderCards) {
        const descInput = card.querySelector('.mobile-order-desc');
        const descVal = descInput.getAttribute('data-full-value') || descInput.value;
        if (descVal.trim()) return true;
    }

    // Sjekk om det er en signatur
    const signature = document.getElementById('mobile-kundens-underskrift').value;
    if (signature) return true;

    return false;
}

function clearForm() {
    document.querySelectorAll('#form-container input, #form-container textarea').forEach(el => el.value = '');
    document.querySelectorAll('#mobile-form input, #mobile-form textarea').forEach(el => {
        el.value = '';
        el.removeAttribute('data-full-value');
    });

    // Clear signature
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    clearSignaturePreview();

    const now = new Date();
    const today = formatDate(now);
    document.getElementById('signering-dato').value = today;
    document.getElementById('mobile-signering-dato').value = today;

    const week = 'Uke ' + getWeekNumber(now);
    document.getElementById('dato').value = week;
    document.getElementById('mobile-dato').value = week;

    sessionStorage.removeItem('firesafe_current');
    sessionStorage.removeItem('firesafe_current_sent');
    lastSavedData = null;
    isExternalForm = false;
    updateExternalBadge();

    // Reset orders to 1 empty card
    const container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    container.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
    updateOrderDeleteStates();

    // Clear desktop work lines
    document.getElementById('work-lines').innerHTML = '';

    window.scrollTo(0, 0);
}

function doNewForm() {
    closeAllModals();
    preNewFormData = getFormData();
    showTemplateModal();
}

function newForm() {
    // Sjekk om vi er på skjema-siden (ikke modal)
    const isOnFormPage = !document.getElementById('saved-modal').classList.contains('active')
        && !document.getElementById('settings-modal').classList.contains('active')
        && !document.getElementById('template-modal').classList.contains('active');

    if (!isOnFormPage) {
        // Fra modal - gå direkte til prosjektmal
        doNewForm();
        return;
    }

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

function duplicateCurrentForm() {
    // Clear order number and signature fields
    document.getElementById('ordreseddel-nr').value = '';
    document.getElementById('mobile-ordreseddel-nr').value = '';
    document.getElementById('kundens-underskrift').value = '';
    document.getElementById('mobile-kundens-underskrift').value = '';
    clearSignaturePreview();

    // Sett uke til nåværende
    var now = new Date();
    var week = 'Uke ' + getWeekNumber(now);
    document.getElementById('dato').value = week;
    document.getElementById('mobile-dato').value = week;

    // Sett signeringsdato til i dag
    var today = formatDate(now);
    document.getElementById('signering-dato').value = today;
    document.getElementById('mobile-signering-dato').value = today;

    // Reset bestillinger til 1 tomt ordrekort
    var container = document.getElementById('mobile-orders');
    container.innerHTML = '';
    container.appendChild(createOrderCard({ description: '', materials: [], timer: '' }, true));
    updateOrderDeleteStates();
    document.getElementById('work-lines').innerHTML = '';

    // Mark as unsaved
    lastSavedData = null;

    // Remove sent banner if visible
    document.getElementById('sent-banner').style.display = 'none';
    setFormReadOnly(false);

    // Auto-fill next order number
    autoFillOrderNumber();
    window.scrollTo(0, 0);
}

// Felles canvas-rendering for eksport/deling
async function renderFormToCanvas() {
    syncMobileToOriginal();

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

    // Midlertidig fjern disabled for ren eksport
    const disabledFields = element.querySelectorAll('input:disabled, textarea:disabled, select:disabled');
    disabledFields.forEach(el => el.disabled = false);

    await new Promise(resolve => requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
    }));

    element.style.visibility = 'visible';
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '';

    const canvas = await html2canvas(element, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
    });

    // Gjenopprett disabled-tilstand
    disabledFields.forEach(el => el.disabled = true);
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
    const ordrenr = document.getElementById('ordreseddel-nr').value || document.getElementById('mobile-ordreseddel-nr').value || 'ukjent';
    const dato = document.getElementById('dato').value.replace(/\./g, '-') || formatDate(new Date()).replace(/\./g, '-');
    return `ordreseddel_${ordrenr}_${dato}.${ext}`;
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
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidth, imgHeight);
        pdf.save(getExportFilename('pdf'));
    } catch (error) {
        showNotificationModal(t('export_pdf_error') + error.message);
    } finally {
        loading.classList.remove('active');
    }
}

async function doExportPNG() {
    if (!validateRequiredFields()) return;
    const loading = document.getElementById('loading');
    loading.classList.add('active');
    try {
        const canvas = await renderFormToCanvas();
        const link = document.createElement('a');
        link.download = getExportFilename('png');
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (error) {
        showNotificationModal(t('export_png_error') + error.message);
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
        await doExportPNG();
    }
    setFormReadOnly(true);
}


// Background click handler removed - saved-modal is now a view, not an overlay

// Event delegation for saved-list items
document.getElementById('saved-list').addEventListener('click', function(e) {
    const savedItem = e.target.closest('.saved-item');
    if (!savedItem) return;

    // Get form data directly from the element
    const formData = savedItem._formData;
    if (!formData) return;

    // Check if click was on a button
    const btn = e.target.closest('button');
    if (btn) {
        e.stopPropagation();
        if (btn.classList.contains('disabled')) return;
        if (btn.classList.contains('copy')) {
            duplicateFormDirect(savedItem._formData);
        } else if (btn.classList.contains('delete')) {
            deleteFormDirect(savedItem._formData);
        }
        return;
    }

    // Click on item row - load the form
    loadFormDirect(savedItem._formData);
});

// Event delegation for external-list items
document.getElementById('external-list').addEventListener('click', function(e) {
    const savedItem = e.target.closest('.saved-item');
    if (!savedItem) return;

    // Get form data directly from the element
    const formData = savedItem._formData;
    if (!formData) return;

    // Check if click was on delete button
    const btn = e.target.closest('button');
    if (btn && btn.classList.contains('delete')) {
        e.stopPropagation();
        deleteExternalFormDirect(formData);
        return;
    }

    // Click on item row - load the form
    loadExternalFormDirect(formData);
});

// Event delegation for template-list items
document.getElementById('template-list').addEventListener('click', function(e) {
    const savedItem = e.target.closest('.saved-item');
    if (!savedItem) return;

    // Get template data directly from the element
    const templateData = savedItem._formData;
    if (!templateData) return;

    // Check if click was on delete button
    const btn = e.target.closest('button');
    if (btn && btn.classList.contains('delete')) {
        e.stopPropagation();
        deleteTemplateDirect(templateData);
        return;
    }

    // Click on item row - load the template
    loadTemplateDirect(templateData);
});


// Background click handler removed - template-modal is now a view, not an overlay

// Sync forms when typing (with debounced sessionStorage save)
var sessionSaveTimeout = null;
function debouncedSessionSave() {
    clearTimeout(sessionSaveTimeout);
    sessionSaveTimeout = setTimeout(function() {
        sessionStorage.setItem('firesafe_current', JSON.stringify(getFormData()));
    }, 1500);
}

document.getElementById('mobile-form').addEventListener('input', function() {
    syncMobileToOriginal();
    debouncedSessionSave();
});

document.getElementById('form-container').addEventListener('input', function() {
    syncOriginalToMobile();
    debouncedSessionSave();
});

document.addEventListener('DOMContentLoaded', function() {
    // PWA pull-to-refresh workaround: Force layout recalculation
    setTimeout(function() {
        void document.body.offsetHeight;
    }, 50);

    const current = sessionStorage.getItem('firesafe_current');
    if (current) {
        try {
            const data = JSON.parse(current);
            setFormData(data);
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

    // Load dropdown options for materials/units
    getDropdownOptions();

    // Load required field settings and update indicators
    getRequiredSettings().then(function(data) {
        cachedRequiredSettings = data;
        updateRequiredIndicators();
    });

    // View is already activated by inline script in HTML.
    // Here we only do data-specific init based on hash.
    const hash = window.location.hash.slice(1);
    if (hash === 'skjema' || hash === 'ekstern') {
        document.getElementById('form-header-title').textContent = t(hash === 'ekstern' ? 'external_form_title' : 'form_title');
        const wasSent = sessionStorage.getItem('firesafe_current_sent') === '1';
        if (wasSent) {
            setFormReadOnly(true);
        }
        updateToolbarState();
    } else if (hash === 'hent') {
        // Trigger background Firestore refresh for saved forms list
        if (currentUser && db) {
            Promise.all([getSavedForms(), getSentForms()]).then(function([savedResult, sentResult]) {
                _savedLastDoc = savedResult.lastDoc;
                _sentLastDoc = sentResult.lastDoc;
                _savedHasMore = savedResult.hasMore;
                _sentHasMore = sentResult.hasMore;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(savedResult.forms.slice(0, 50)));
                localStorage.setItem(ARCHIVE_KEY, JSON.stringify(sentResult.forms.slice(0, 50)));
                window.loadedForms = savedResult.forms.map(f => ({ ...f, _isSent: false })).concat(sentResult.forms.map(f => ({ ...f, _isSent: true })));
                if (document.body.classList.contains('saved-modal-open')) {
                    renderSavedFormsList(window.loadedForms, false, _savedHasMore || _sentHasMore);
                }
            }).catch(function(e) { console.error('Refresh saved forms:', e); });
        }
        // Show cached data immediately
        var cachedSaved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        var cachedSent = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
        renderSavedFormsList(cachedSaved.map(f => ({ ...f, _isSent: false })).concat(cachedSent.map(f => ({ ...f, _isSent: true }))));
        updateToolbarState();
    } else if (!hash || hash === '') {
        // Home page - render cached templates (filter out deactivated)
        var cached = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]').filter(function(t) { return t.active !== false; });
        renderTemplateList(cached);
        updateToolbarState();
        // Background refresh
        if (currentUser && db) {
            getTemplates().then(function(result) {
                _templateLastDoc = result.lastDoc;
                _templateHasMore = result.hasMore;
                localStorage.setItem(TEMPLATE_KEY, JSON.stringify(result.forms.slice(0, 50)));
                if (document.body.classList.contains('template-modal-open')) {
                    var activeTemplates = result.forms.filter(function(t) { return t.active !== false; });
                    renderTemplateList(activeTemplates, false, _templateHasMore);
                }
            }).catch(function(e) { console.error('Refresh templates:', e); });
        }
    }
});

// Handle browser back/forward buttons
window.addEventListener('hashchange', function() {
    if (!currentUser) return; // Ikke naviger uten innlogging
    const hash = window.location.hash.slice(1);
    // Don't close modals for hent/settings - those functions handle it themselves
    if (hash === 'hent') {
        showSavedForms();
    } else if (hash === 'settings') {
        showSettingsModal();
    } else if (hash === 'skjema') {
        showView('view-form');
        document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open');
        document.getElementById('form-header-title').textContent = t('form_title');
    } else if (hash === 'ekstern') {
        showView('view-form');
        document.body.classList.remove('template-modal-open', 'saved-modal-open', 'settings-modal-open');
        document.getElementById('form-header-title').textContent = t('external_form_title');
    } else {
        // No hash = home = template modal
        showTemplateModal();
    }
});


