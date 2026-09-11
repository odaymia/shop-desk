import { DEFAULT_OIL_PACKAGES } from "./oilchange.js";
import { DEFAULT_CHECKLIST } from "./checklist.js";
import { DEFAULT_SERVICE_MENU } from "./services.js";
/* Shop settings and their defaults. Saved config is merged over these. */

export const DEFAULT_CFG = {
  shopName: "",
  shopPhone: "",
  shopAddress: "", // free text, printed on the invoice header
  shopEmail: "",
  shopWebsite: "",
  carfaxLocationId: "", // assigned by CARFAX when the shop joins the Service Network
  catalogs: { oreilly: true, partstech: true }, // which parts catalogs get a button on the ticket
  partsMarkupPct: 35, // sell price = catalog cost + this percent, unless list is higher
  partsPriceEnding99: false,
  partsTechUser: "", // the shop's PartsTech login (email) and API key, from PartsTech → My Account → API
  partsTechKey: "",
  ardNumber: "", // California BAR registration (ARD) number, printed on every estimate and invoice
  logo: "", // data URL of the shop logo; blank shows the bundled Genie logo
  printStaffNames: "full", // off | full | first-initial | initials — writer and tech on printed tickets
  plateApiKey: "", // PlateToVIN key for plate → VIN lookups; blank hides the button
  weekStart: 1, // 0=Sun ... 6=Sat; used by the "This week" report range
  laborRate: 150, // default $/hour for labor lines
  taxRate: 7.75, // percent; San Diego city rate
  partsTaxable: true,
  laborTaxable: false, // California doesn't tax repair labor
  subletTaxable: false,
  suppliesPct: 0, // a generic "shop supplies" charge is prohibited on California invoices (16 CCR 3356); other states may set a percent of labor
  suppliesCap: 0, // never more than this per ticket; 0 = no cap
  suppliesTaxable: true,
  oilChangeLaborPrice: 0, // flat labor added by "Add oil change"; 0 = parts only, add your own labor
  oilPackages: DEFAULT_OIL_PACKAGES, // the Oil change button's menu; edited in Settings
  serviceMenu: DEFAULT_SERVICE_MENU, // the buttons on a ticket: oil change, then a button per canned job category
  checklist: DEFAULT_CHECKLIST, // the service checklist run on every oil change; edited in Settings
  checklistOnOil: true, // open the checklist as soon as an oil change goes on a ticket
  portalEnabled: false, // customer portal: publish customer records for sign-in at /portal/
  hours: "", // free text for the portal card: "Mon–Fri 8–6, Sat 8–2"
  nextOrderNumber: 1001, // first estimate/RO/invoice number; the live counter is in sd:counters
  invoiceFooter:
    "Thank you for your business. Parts and labor are warranted for 12 months or 12,000 miles, whichever comes first. Returned parts are subject to a restocking fee.",
  authorizationText:
    "I authorize the repair work described above along with the necessary materials. I understand that an express mechanic's lien is acknowledged on the vehicle to secure the amount of repairs.",
};
