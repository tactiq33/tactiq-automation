/* TactIQ legal pages — language toggle.
   Without JavaScript both languages stay visible (Arabic first), so the page is
   always readable. With JavaScript one language is shown at a time and the
   choice is remembered. */
(function () {
  document.documentElement.className += ' js';
  document.addEventListener('DOMContentLoaded', function () {
    var secs = { ar: document.getElementById('ar'), en: document.getElementById('en') };
    var btns = document.querySelectorAll('[data-lang]');
    if (!secs.ar || !secs.en) return;

    function apply(lang) {
      secs.ar.className = lang === 'ar' ? 'doc' : 'doc hide';
      secs.en.className = lang === 'en' ? 'doc' : 'doc hide';
      for (var i = 0; i < btns.length; i++) {
        btns[i].className = btns[i].getAttribute('data-lang') === lang ? 'on' : '';
      }
      try { localStorage.setItem('tactiq_legal_lang', lang); } catch (e) {}
      document.documentElement.lang = lang;
    }

    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () { apply(this.getAttribute('data-lang')); });
    }

    var saved = null;
    try { saved = localStorage.getItem('tactiq_legal_lang'); } catch (e) {}
    if (!saved) saved = (navigator.language || 'ar').slice(0, 2) === 'ar' ? 'ar' : 'en';
    apply(saved === 'en' ? 'en' : 'ar');
  });
})();
