/**
 * What the product is called, in one place.
 *
 * The package names, container names and database identifiers stay `kidpc`:
 * renaming those would be a migration, not a rebrand, and internal identifiers
 * are not what a parent reads. This constant covers every surface a person
 * actually sees -- with the deliberate exception of index.html and the web
 * manifest, which are static files loaded before any JavaScript runs and so
 * must carry the name literally.
 */
export const PRODUCT_NAME = 'Online Kids PC';

/** For the browser tab, the installed-app label, and anywhere space is tight. */
export const PRODUCT_SHORT_NAME = 'Kids PC';

export const PRODUCT_TAGLINE = 'A safe computer for your child, on the screen you already own.';
