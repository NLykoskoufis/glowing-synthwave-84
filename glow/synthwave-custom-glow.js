(function () {
  //====================================================================
  // Neon glow for control-flow keywords.
  //
  // VS Code themes cannot express text-shadow, so the glow is applied by
  // rewriting the stylesheet VS Code generates for syntax tokens.
  //
  // The rewrite is keyed on hex value, NOT on Monaco's .mtkN classes:
  // those numbers are assigned by index into the active theme's colour
  // list and shift whenever colours are added or reordered.
  //
  // Each supported theme assigns keyword.control a hex that nothing else
  // uses — always one step off its own keyword colour, so with the glow
  // off the two are indistinguishable. Only those hexes are mapped, so
  // only control flow lights up.
  //
  // Safety design (a previous version crash-looped VS Code):
  //  - our <style> is appended to <head>; we never mutate <body>, so the
  //    body observer can never see our own writes
  //  - rebuilds are keyed on the token stylesheet's text; if it hasn't
  //    changed, nothing is written
  //  - rebuilds are debounced through requestAnimationFrame, so a burst
  //    of mutations costs one rebuild per frame at worst
  //
  // Loaded by be5invis.vscode-custom-css via vscode_custom_css.imports.
  //====================================================================

  // Brightness 0.45 -> Math.floor(0.45 * 255) = 114 = 0x72
  const NEON_BRIGHTNESS = '72';

  const shadow = (halo, near) =>
    'text-shadow: 0 0 2px ' + near + ', 0 0 8px ' + halo + NEON_BRIGHTNESS +
    ', 0 0 2px ' + halo + NEON_BRIGHTNESS + '; backface-visibility: hidden;';

  // hex in the theme -> the colour it is rendered as, plus its halo.
  const tokenReplacements = {
    // Glowing SynthWave '84 — amber halo
    'fede5c': 'color: #f4eee4; ' + shadow('#f39f05', '#393a33'),
    // Frizlo Warm Kitchen — paprika halo
    'f08a3d': 'color: #FDF3E7; ' + shadow('#F08A3E', '#3A2517'),
    // Fifty Shades of Purple — orchid halo
    'ba68c7': 'color: #F7EEFB; ' + shadow('#9B59B6', '#241634'),
    // Black Ice — cyan halo
    '22d3ed': 'color: #E9FCFF; ' + shadow('#06B6D4', '#0C2129'),
  };

  const STYLE_ID = 'neon-glow-styles';
  const OFF_KEY = 'neonGlow';

  /**
   * @summary Runtime kill switch. Set localStorage.neonGlow = 'off' in the
   * developer tools and reload to disable without touching settings.
   * @returns {boolean}
   */
  const disabledAtRuntime = () => {
    try {
      return localStorage.getItem(OFF_KEY) === 'off';
    } catch (e) {
      return false;
    }
  };

  /**
   * @summary Is one of the supported themes active? The class is derived
   * from the extension identity, so this deliberately does not match the
   * original RobbOwen SynthWave extension.
   * @returns {boolean}
   */
  const usingSupportedTheme = () =>
    !!document.querySelector(
      '[class*="synthwave-custom"],' +
      '[class*="glowing-synthwave"],' +
      '[class*="frizlo-warm-kitchen"],' +
      '[class*="fifty-shades-of-purple"],' +
      '[class*="black-ice-theme"],' +
      '[class*="app-palette-themes"]'
    );

  /**
   * @summary Which mapped hexes are present in the token stylesheet text?
   *
   * Some-of, not all-of: only one theme is loaded at a time, so requiring
   * every hex would mean the script never initialises.
   * @param {string} styles lower-cased stylesheet text
   * @returns {string[]}
   */
  const presentColors = (styles) =>
    Object.keys(tokenReplacements).filter((c) => styles.includes('#' + c));

  const replaceTokens = (styles, colors) =>
    colors.reduce((acc, color) => {
      const re = new RegExp('color: #' + color + ';', 'gi');
      return acc.replace(re, tokenReplacements[color]);
    }, styles);

  /** @summary Our injected <style>, or null. */
  const glowEl = () => document.querySelector('#' + STYLE_ID);

  /** @summary Drop our injected stylesheet, if present. */
  const removeGlow = () => {
    const existing = glowEl();
    if (existing) existing.remove();
  };

  // Text of the token stylesheet the current glow sheet was built from.
  // Rebuilds are skipped while it is unchanged — this, not an observer
  // guard, is what makes the script loop-proof.
  let builtFrom = null;

  /**
   * @summary Bring the glow stylesheet in sync with the token styles.
   *
   * Idempotent: called with an unchanged token stylesheet it does nothing.
   * Our sheet is a copy of VS Code's token styles appended after them in
   * <head>, so it wins on DOM order; on theme change the copy is rebuilt,
   * and removed outright when the new theme has no mapped hex — a stale
   * copy would freeze every syntax colour to the previous theme.
   */
  const syncGlow = () => {
    if (disabledAtRuntime()) {
      removeGlow();
      builtFrom = null;
      window.__neonGlowState = { disabled: true };
      return;
    }

    const tokensEl = document.querySelector('.vscode-tokens-styles');
    const styles = tokensEl ? tokensEl.innerText : '';
    const colors = presentColors(styles.toLowerCase());

    if (!tokensEl || !usingSupportedTheme() || !colors.length) {
      removeGlow();
      builtFrom = null;
      window.__neonGlowState = {
        tokensElFound: !!tokensEl,
        themeMatched: usingSupportedTheme(),
        hexesFound: colors,
      };
      return;
    }

    if (styles === builtFrom && glowEl()) {
      return; // already in sync — never rewrite what hasn't changed
    }

    removeGlow();
    const styleTag = document.createElement('style');
    styleTag.setAttribute('id', STYLE_ID);
    styleTag.innerText = replaceTokens(styles, colors).replace(
      /(\r\n|\n|\r)/gm,
      ''
    );
    document.head.appendChild(styleTag);
    builtFrom = styles;
    window.__neonGlowState = { lit: colors };
    console.log('Neon glow applied for #' + colors.join(', #'));
  };

  // The custom-css loader inlines this script into <head>, so document.body
  // is still null at execution time; wait for the DOM before observing.
  const start = () => {
    // Coalesce mutation bursts: one syncGlow per animation frame at most.
    let scheduled = false;
    const scheduleSync = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        syncGlow();
      });
    };

    let watchedTokensEl = null;
    const tokensObserver = new MutationObserver(scheduleSync);

    // Finds the token stylesheet (VS Code can also replace the element
    // wholesale) and keeps the content observer attached to it.
    const attach = () => {
      const tokensEl = document.querySelector('.vscode-tokens-styles');
      if (tokensEl && tokensEl !== watchedTokensEl) {
        tokensObserver.disconnect();
        tokensObserver.observe(tokensEl, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        watchedTokensEl = tokensEl;
      }
      scheduleSync();
    };

    // Watching <body> is safe because our own writes only touch <head>.
    new MutationObserver(attach).observe(document.body, {
      attributes: true,
      childList: true,
      subtree: false,
    });

    attach();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
