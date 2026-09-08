/* Shop settings and their defaults. Saved config is merged over these. */

export const DEFAULT_CFG = {
  shopName: "",
  shopPhone: "",
  shopAddress: "", // free text, printed on the invoice header
  shopEmail: "",
  shopWebsite: "",
  carfaxLocationId: "", // assigned by CARFAX when the shop joins the Service Network
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
  nextOrderNumber: 1001, // first estimate/RO/invoice number; the live counter is in sd:counters
  invoiceFooter:
    "Thank you for your business. Parts and labor are warranted for 12 months or 12,000 miles, whichever comes first. Returned parts are subject to a restocking fee.",
  authorizationText:
    "I authorize the repair work described above along with the necessary materials. I understand that an express mechanic's lien is acknowledged on the vehicle to secure the amount of repairs.",
};
