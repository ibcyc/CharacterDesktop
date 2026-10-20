// Character rules shared by the desktop character page (app/pet.js) and the settings page.
// Both pages load this file first; extensions build their own rules on the poke session below.

const POKE_EXPRESSION_MS = 2500;  // how long a poke's temporary expression stays
const FIFTH_POKE = 5;             // every fifth poke reacts more

// ---------- Local characters ----------
// The user's own pictures (app/local.cjs): files maps expression ids to pictures, '0' being the default look.
function isLocal(entry) { return entry?.kind === 'local'; }
function localExpressions(entry) { return Object.keys(entry?.files || {}).map(Number).sort((a, b) => a - b).map(String); }
function localExpressionLabel(id) { return id === '0' ? 'Default' : 'Expression ' + id; }

// ---------- Pokes ----------
// Poke state for the character on screen: how many pokes so far and the temporary expression.
// redraw() is called whenever the temporary expression changes the appearance.
function createPokeSession(redraw) {
  let count = 0, temporary = null, temporaryTimer = null, holdUntil = 0;
  const session = {
    get count() { return count; },
    get temporaryExpression() { return temporary; },
    countPoke() { return ++count; },
    resetCount() { count = 0; },
    reset() {
      count = 0;
      clearTimeout(temporaryTimer); temporaryTimer = null;
      temporary = null;
      holdUntil = 0;
    },
    // Shows an expression for `ms`; a held one is not replaced until it ends.
    showExpression(id, ms = POKE_EXPRESSION_MS, hold = false) {
      if (!id || Date.now() < holdUntil) return;
      temporary = id;
      holdUntil = hold ? Date.now() + ms : 0;
      redraw();
      clearTimeout(temporaryTimer);
      temporaryTimer = setTimeout(() => { temporaryTimer = null; temporary = null; holdUntil = 0; redraw(); }, ms);
    },
    // A local character's poke (the page makes the picture bounce): the poke expression shows, or on every fifth
    // poke the fifth-poke expression, held, for POKE_EXPRESSION_MS. With no expression chosen the look stays.
    pokeLocal({ pokeFace, fifthFace }) {
      const special = session.countPoke() >= FIFTH_POKE;
      if (special) session.resetCount();
      const expression = (special ? fifthFace : pokeFace) || null;
      session.showExpression(expression, POKE_EXPRESSION_MS, special);
      return { local: true, special, expression };
    }
  };
  return session;
}
