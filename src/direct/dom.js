/* The one-character helper that four modules in direct/ want, in the one
   place that does not force them to import each other to get it. */
export const $ = id => document.getElementById(id);
