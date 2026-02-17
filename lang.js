const TRANSLATIONS = {
    no: {
        // Toolbar
        toolbar_new: 'Ny',
        toolbar_save: 'Lagre',
        toolbar_load: 'Hent',
        toolbar_export: 'Eksport',

        // Login
        login: 'Logg inn',
        logout: 'Logg ut',
        logout_confirm: 'Vil du logge ut?',
        logout_success: 'Du er nå logget ut',
        login_success: 'Logget inn som ',
        login_failed: 'Innlogging feilet: ',
        login_choose_provider: 'Velg innloggingsmetode',
        login_google: 'Logg inn med Google',
        login_microsoft: 'Logg inn med Microsoft',
        firebase_not_configured: 'Firebase er ikke konfigurert. Sjekk firebaseConfig i script.js',

        // Loading
        generating_file: 'Genererer fil...',

        // Sent banner
        sent_banner_text: 'Dette skjemaet er sendt og kan ikke redigeres',
        sent_banner_move: 'Flytt til lagrede',

        // Mobile form header
        form_subtitle: 'Ordreseddel',
        beta_label: 'Beta',

        // Field labels
        label_ordreseddel_nr: 'Ordreseddel nr.',
        label_uke: 'Uke',
        label_montor: 'Montør',
        label_avdeling: 'Avdeling',
        label_oppdragsgiver: 'Oppdragsgiver',
        label_kundens_ref: 'Kundens ref.',
        label_fakturaadresse: 'Fakturaadresse',
        label_prosjektnr: 'Prosjektnr.',
        label_prosjektnavn: 'Prosjektnavn',
        label_sted: 'Sted',
        label_dato: 'Dato',
        label_kundens_underskrift: 'Kundens underskrift',
        signature_tap_to_sign: 'Trykk for å signere',
        signature_title: 'Signer her',
        signature_clear: 'Slett signatur',
        signature_clear_short: 'Slett',
        signature_confirm: 'Bekreft',

        // Sections
        section_work: 'Utførte arbeider',
        section_signing: 'Signering',

        // Order cards
        order_description: 'Beskrivelse',
        order_materials_label: 'Materialer',
        order_add_material: 'Materialer',
        order_hours: 'Timer',
        order_add: '+ Legg til bestilling',
        order_delete_confirm: 'Slett denne bestillingen?',

        // Material placeholders
        placeholder_material: 'Materiale',
        placeholder_quantity: 'Antall',
        placeholder_unit: 'Enhet',

        // Text editor
        text_editor_done: 'Ferdig',
        text_editor_placeholder: 'Beskriv utført arbeid...',

        // Save menu
        save_menu_title: 'Lagre skjema',
        save_option: 'Lagre',
        save_as_template: 'Lagre som mal',

        // Save confirmations
        confirm_save: 'Er du sikker på at du vil lagre skjemaet?',
        confirm_update: 'Dette ordrenummeret finnes allerede. Vil du oppdatere det?',
        save_success: 'Skjema lagret!',
        update_success: 'Skjema oppdatert!',
        save_error: 'Feil ved lagring: ',
        duplicate_in_sent: 'Ordreseddel nr. {0} finnes allerede i sendte.',
        btn_save: 'Lagre',
        btn_update: 'Oppdater',

        // Export menu
        export_title: 'Eksporter som',
        export_only_label: 'Kun eksporter',
        export_and_mark_label: 'Eksporter + marker som sendt',
        btn_cancel: 'Avbryt',
        btn_clear: 'Fjern',
        duplicate_btn: 'Dupliser',
        edit_btn: 'Rediger',
        delete_btn: 'Slett',
        export_pdf_error: 'Feil ved generering av PDF: ',
        export_png_error: 'Feil ved generering av PNG: ',

        // Hent modal
        modal_load_title: 'Hent skjema',
        tab_own: 'Egne',
        tab_external: 'Eksterne',
        search_placeholder: 'Søk ordrenummer...',
        search_template_placeholder: 'Søk prosjekt...',
        loading: 'Laster...',
        no_saved_forms: 'Ingen lagrede skjemaer',
        no_external_forms: 'Ingen eksterne skjemaer',
        no_templates: 'Ingen prosjektmaler',
        load_more: 'Last flere',

        // List items
        no_name: 'Uten navn',

        // Form actions
        delete_confirm: 'Er du sikker på at du vil slette dette skjemaet?',
        delete_sent_confirm: 'Er du sikker på at du vil slette dette skjemaet permanent?',
        move_to_saved_confirm: 'Vil du flytte dette skjemaet til lagrede?',
        move_to_saved_success: 'Skjema flyttet til lagrede!',
        marked_as_sent: 'Skjema markert som sendt!',
        btn_move: 'Flytt',
        duplicated_success: 'Skjema duplisert — husk å lagre!',
        copied_to_clipboard: 'Kopiert!',

        // New form
        new_form_confirm: 'Vil du starte et nytt skjema? Ulagrede endringer vil gå tapt.',
        btn_start_new: 'Start ny',

        // Templates
        template_modal_title: 'Velg prosjektmal',
        template_new_form: 'Eget skjema',
        template_blank_form: 'Tomt skjema',
        template_save_success: 'Prosjektmal lagret!',
        template_duplicated: 'Mal duplisert — rediger og lagre!',
        template_update_success: 'Mal oppdatert!',
        template_exists: 'En mal med prosjektnavn «{0}» finnes allerede. Vil du oppdatere den?',
        template_name_required: 'Du må fylle inn prosjektnavn for å lagre som mal',
        template_save_error: 'Feil ved lagring av mal: ',
        template_delete_confirm: 'Er du sikker på at du vil slette denne malen?',

        // Settings
        settings_title: 'Innstillinger',
        settings_ordrenr: 'Ordreseddelnummer',
        settings_defaults: 'Autofyll',
        settings_fields: 'Feltinnstillinger',
        settings_templates: 'Maler',
        settings_new_template: '+ Ny mal',
        settings_edit_template: 'Rediger mal',
        settings_template_deactivate: 'Deaktiver',
        settings_template_activate: 'Aktiver',
        settings_template_inactive: '(deaktivert)',
        no_templates_settings: 'Ingen maler',
        template_updated: 'Mal oppdatert!',
        settings_language: 'Språk / Language',
        settings_saved: 'Innstillinger lagret!',
        settings_add_range: 'Legg til minst ett nummerområde.',
        settings_range_error: '"Fra" må være mindre enn eller lik "Til".',
        settings_range_overlap: 'Området overlapper med et eksisterende nummerområde.',
        settings_range_added: 'Nummerområde lagt til!',
        settings_range_remove: 'Fjerne nummerområde {0} – {1}?',
        settings_no_ranges: 'Ingen nummerområder lagt til',
        settings_used: 'Brukt: {0} av {1}',
        settings_next: 'Neste: {0}',
        settings_all_used: 'Alle brukt!',
        settings_my_numbers: 'Mine numre',
        settings_given_away: 'Gitt bort',
        settings_given_away_count: 'Gitt bort: {0}',
        settings_give_btn: 'Gi bort',
        settings_give_added: 'Numre markert som gitt bort!',
        settings_give_remove: 'Få tilbake «{0}»?',
        settings_give_not_in_range: 'Numrene må være innenfor et registrert nummerområde.',
        settings_give_overlap: 'Overlapper med numre som allerede er gitt bort.',
        settings_give_already_used: 'Nummer {0} er allerede brukt i en ordreseddel.',
        settings_defaults_saved: 'Standardverdier lagret!',
        settings_values_header: 'Verdier',
        settings_autofill_header: 'Automatisk utfylling',
        placeholder_from: 'Fra',
        placeholder_to: 'Til',
        btn_save_settings: 'Lagre',
        btn_add: 'Legg til',

        // Materials & units settings
        settings_materials: 'Materialer og enheter',
        settings_materials_list: 'Materialer',
        settings_units_list: 'Enheter',
        placeholder_new_material: 'Nytt materiale',
        placeholder_new_unit: 'Ny enhet',
        settings_material_added: 'Materiale lagt til!',
        settings_unit_added: 'Enhet lagt til!',
        settings_material_exists: 'Dette materialet finnes allerede.',
        settings_unit_exists: 'Denne enheten finnes allerede.',
        settings_material_remove: 'Fjerne «{0}»?',
        settings_no_materials: 'Ingen materialer lagt til',
        settings_no_units: 'Ingen enheter lagt til',
        picker_custom: 'Egendefinert',
        picker_add: 'Legg til',
        picker_ok: 'Ok',
        picker_incomplete: '{0} mangler antall eller enhet.',
        picker_search_placeholder: 'Søk eller legg til materiale...',
        settings_spec_toggle: 'Trenger spesifikasjon',
        spec_popup_placeholder: 'f.eks. Ø50mm',
        material_exists: 'Materialet finnes allerede',

        // Required fields settings
        settings_required: 'Krav ved lagring',
        settings_req_save: 'Lagre / Eksport',
        settings_req_template: 'Mal',
        settings_req_beskrivelse: 'Beskrivelse (minst 1 ordre)',
        validation_kundens_ref: 'Kundens ref.',
        validation_fakturaadresse: 'Fakturaadresse',
        validation_signatur: 'Kundens underskrift',

        // Language page
        lang_norwegian: 'Norsk',
        lang_english: 'English',

        // Validation
        required_field: 'Du må fylle inn {0}',
        required_order: 'Du må legge til minst én bestilling',
        required_description: 'Beskrivelse mangler for bestilling {0}',
        validation_ordreseddel_nr: 'Ordreseddel nr.',
        validation_dato: 'Dato',
        validation_oppdragsgiver: 'Oppdragsgiver',
        validation_prosjektnr: 'Prosjektnr.',
        validation_prosjektnavn: 'Prosjektnavn',
        validation_montor: 'Montør',
        validation_avdeling: 'Avdeling',
        validation_sted: 'Sted',
        validation_signering_dato: 'Signering dato',

        // Confirm modal defaults
        confirm_default: 'Er du sikker?',
        btn_remove: 'Fjern',

        // External order
        external_order_btn: 'Ekstern skjema',
        external_badge: 'Eksternt',
        own_badge: 'Eget',
        form_title: 'Ordreseddel',
        external_form_title: 'Ekstern ordreseddel',
        validation_nr_not_in_range: 'Ordrenummer {0} er ikke innenfor dine registrerte områder',
        validation_nr_is_own: 'Dette nummeret tilhører dine egne områder. Bruk «Nytt skjema» i stedet.',

        // Desktop export labels (used in buildDesktopWorkLines)
        export_materials: 'Materiell:',
        export_hours: 'Timer:',
        export_hours_unit: 'timer',
        export_total: 'Totalt:',
    },
    en: {
        // Toolbar
        toolbar_new: 'New',
        toolbar_save: 'Save',
        toolbar_load: 'Load',
        toolbar_export: 'Export',

        // Login
        login: 'Log in',
        logout: 'Log out',
        logout_confirm: 'Do you want to log out?',
        logout_success: 'You are now logged out',
        login_success: 'Logged in as ',
        login_failed: 'Login failed: ',
        login_choose_provider: 'Choose login method',
        login_google: 'Sign in with Google',
        login_microsoft: 'Sign in with Microsoft',
        firebase_not_configured: 'Firebase is not configured. Check firebaseConfig in script.js',

        // Loading
        generating_file: 'Generating file...',

        // Sent banner
        sent_banner_text: 'This form has been sent and cannot be edited',
        sent_banner_move: 'Move to saved',

        // Mobile form header
        form_subtitle: 'Order Form',
        beta_label: 'Beta',

        // Field labels
        label_ordreseddel_nr: 'Order no.',
        label_uke: 'Week',
        label_montor: 'Technician',
        label_avdeling: 'Department',
        label_oppdragsgiver: 'Client',
        label_kundens_ref: 'Customer ref.',
        label_fakturaadresse: 'Invoice address',
        label_prosjektnr: 'Project no.',
        label_prosjektnavn: 'Project name',
        label_sted: 'Location',
        label_dato: 'Date',
        label_kundens_underskrift: 'Customer signature',
        signature_tap_to_sign: 'Tap to sign',
        signature_title: 'Sign here',
        signature_clear: 'Clear signature',
        signature_clear_short: 'Clear',
        signature_confirm: 'Confirm',

        // Sections
        section_work: 'Completed work',
        section_signing: 'Signing',

        // Order cards
        order_description: 'Description',
        order_materials_label: 'Materials',
        order_add_material: 'Materials',
        order_hours: 'Hours',
        order_add: '+ Add order',
        order_delete_confirm: 'Delete this order?',

        // Material placeholders
        placeholder_material: 'Material',
        placeholder_quantity: 'Quantity',
        placeholder_unit: 'Unit',

        // Text editor
        text_editor_done: 'Done',
        text_editor_placeholder: 'Describe completed work...',

        // Save menu
        save_menu_title: 'Save form',
        save_option: 'Save',
        save_as_template: 'Save as template',

        // Save confirmations
        confirm_save: 'Are you sure you want to save the form?',
        confirm_update: 'This order number already exists. Do you want to update it?',
        save_success: 'Form saved!',
        update_success: 'Form updated!',
        save_error: 'Error saving: ',
        duplicate_in_sent: 'Order no. {0} already exists in sent.',
        btn_save: 'Save',
        btn_update: 'Update',

        // Export menu
        export_title: 'Export as',
        export_only_label: 'Export only',
        export_and_mark_label: 'Export + mark as sent',
        btn_cancel: 'Cancel',
        btn_clear: 'Clear',
        duplicate_btn: 'Duplicate',
        edit_btn: 'Edit',
        delete_btn: 'Delete',
        export_pdf_error: 'Error generating PDF: ',
        export_png_error: 'Error generating PNG: ',

        // Hent modal
        modal_load_title: 'Load form',
        tab_own: 'Own',
        tab_external: 'External',
        search_placeholder: 'Search order number...',
        search_template_placeholder: 'Search project...',
        loading: 'Loading...',
        no_saved_forms: 'No saved forms',
        no_external_forms: 'No external forms',
        no_templates: 'No project templates',
        load_more: 'Load more',

        // List items
        no_name: 'Untitled',

        // Form actions
        delete_confirm: 'Are you sure you want to delete this form?',
        delete_sent_confirm: 'Are you sure you want to permanently delete this form?',
        move_to_saved_confirm: 'Do you want to move this form to saved?',
        move_to_saved_success: 'Form moved to saved!',
        marked_as_sent: 'Form marked as sent!',
        btn_move: 'Move',
        duplicated_success: 'Form duplicated — remember to save!',
        copied_to_clipboard: 'Copied!',

        // New form
        new_form_confirm: 'Start a new form? Unsaved changes will be lost.',
        btn_start_new: 'Start new',

        // Templates
        template_modal_title: 'Choose project template',
        template_new_form: 'Own form',
        template_blank_form: 'Blank form',
        template_save_success: 'Project template saved!',
        template_duplicated: 'Template duplicated — edit and save!',
        template_update_success: 'Template updated!',
        template_exists: 'A template with project name "{0}" already exists. Do you want to update it?',
        template_name_required: 'You must fill in the project name to save as a template',
        template_save_error: 'Error saving template: ',
        template_delete_confirm: 'Are you sure you want to delete this template?',

        // Settings
        settings_title: 'Settings',
        settings_ordrenr: 'Order numbers',
        settings_defaults: 'Autofill',
        settings_fields: 'Field settings',
        settings_templates: 'Templates',
        settings_new_template: '+ New template',
        settings_edit_template: 'Edit template',
        settings_template_deactivate: 'Deactivate',
        settings_template_activate: 'Activate',
        settings_template_inactive: '(deactivated)',
        no_templates_settings: 'No templates',
        template_updated: 'Template updated!',
        settings_language: 'Språk / Language',
        settings_saved: 'Settings saved!',
        settings_add_range: 'Add at least one number range.',
        settings_range_error: '"From" must be less than or equal to "To".',
        settings_range_overlap: 'The range overlaps with an existing number range.',
        settings_range_added: 'Number range added!',
        settings_range_remove: 'Remove number range {0} – {1}?',
        settings_no_ranges: 'No number ranges added',
        settings_used: 'Used: {0} of {1}',
        settings_next: 'Next: {0}',
        settings_all_used: 'All used!',
        settings_my_numbers: 'My numbers',
        settings_given_away: 'Given away',
        settings_given_away_count: 'Given away: {0}',
        settings_give_btn: 'Give away',
        settings_give_added: 'Numbers marked as given away!',
        settings_give_remove: 'Get back "{0}"?',
        settings_give_not_in_range: 'Numbers must be within a registered number range.',
        settings_give_overlap: 'Overlaps with numbers already given away.',
        settings_give_already_used: 'Number {0} is already used in an order form.',
        settings_defaults_saved: 'Default values saved!',
        settings_values_header: 'Values',
        settings_autofill_header: 'Auto-fill',
        placeholder_from: 'From',
        placeholder_to: 'To',
        btn_save_settings: 'Save',
        btn_add: 'Add',

        // Materials & units settings
        settings_materials: 'Materials and units',
        settings_materials_list: 'Materials',
        settings_units_list: 'Units',
        placeholder_new_material: 'New material',
        placeholder_new_unit: 'New unit',
        settings_material_added: 'Material added!',
        settings_unit_added: 'Unit added!',
        settings_material_exists: 'This material already exists.',
        settings_unit_exists: 'This unit already exists.',
        settings_material_remove: 'Remove "{0}"?',
        settings_no_materials: 'No materials added',
        settings_no_units: 'No units added',
        picker_custom: 'Custom',
        picker_add: 'Add',
        picker_ok: 'Ok',
        picker_incomplete: '{0} is missing quantity or unit.',
        picker_search_placeholder: 'Search or add material...',
        settings_spec_toggle: 'Needs specification',
        spec_popup_placeholder: 'e.g. Ø50mm',
        material_exists: 'Material already exists',

        // Required fields settings
        settings_required: 'Save requirements',
        settings_req_save: 'Save / Export',
        settings_req_template: 'Template',
        settings_req_beskrivelse: 'Description (at least 1 order)',
        validation_kundens_ref: 'Customer ref.',
        validation_fakturaadresse: 'Invoice address',
        validation_signatur: 'Customer signature',

        // Language page
        lang_norwegian: 'Norsk',
        lang_english: 'English',

        // Validation
        required_field: 'You must fill in {0}',
        required_order: 'You must add at least one order',
        required_description: 'Description missing for order {0}',
        validation_ordreseddel_nr: 'Order no.',
        validation_dato: 'Date',
        validation_oppdragsgiver: 'Client',
        validation_prosjektnr: 'Project no.',
        validation_prosjektnavn: 'Project name',
        validation_montor: 'Technician',
        validation_avdeling: 'Department',
        validation_sted: 'Location',
        validation_signering_dato: 'Signing date',

        // Confirm modal defaults
        confirm_default: 'Are you sure?',
        btn_remove: 'Remove',

        // External order
        external_order_btn: 'External form',
        external_badge: 'External',
        own_badge: 'Own',
        form_title: 'Order form',
        external_form_title: 'External order form',
        validation_nr_not_in_range: 'Order number {0} is not within your registered ranges',
        validation_nr_is_own: 'This number belongs to your own ranges. Use "New form" instead.',

        // Desktop export labels (used in buildDesktopWorkLines)
        export_materials: 'Materials:',
        export_hours: 'Hours:',
        export_hours_unit: 'hours',
        export_total: 'Total:',
    }
};
