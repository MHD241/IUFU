/* Public connection details for the IUFyou video database.
   The URL and publishable key are designed to be public (they only allow what the database's
   row-level security allows). NEVER put a service-role / secret key in this file.
   "live": false = the public website still reads its built-in list from content.js.
   Set it to true only when the database content has been approved for the public site. */
window.IUFU_CFG = {
  url: "https://cyelrzslfmwsiswbnuos.supabase.co",
  key: "sb_publishable_JEDNfKv0_iPhZNRXWyoWBA_JabQ-67L",
  live: true
};
