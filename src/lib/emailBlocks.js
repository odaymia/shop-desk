/* The pieces an email is built from, the starter layouts, and the photos to
   choose from. Pure data plus small helpers; src/lib/emailCompose.js fills
   in the shop's details and src/lib/emailRender.js draws the email.

   A block links somewhere with `link`: "site" (the shop's website), "review"
   (its Google review page), "offer" (the email's coupon page), "service"
   (a service's page), "custom" (`url`), or "" for no link. */
import { SERVICE_CONTENT } from "./serviceContent.js";

const str = (s) => String(s == null ? "" : s).trim();
const rid = () => "b" + Math.random().toString(36).slice(2, 8);

export const BLOCK_TYPES = [
  ["hero", "Hero", "Big photo, headline, and a button"],
  ["text", "Text", "A heading and paragraphs"],
  ["coupon", "Coupon", "A coupon from your Coupons list"],
  ["services", "Services", "Tiles with a photo and price, linking to each service's page"],
  ["split", "Photo + text", "A photo beside a short message"],
  ["image", "Image", "One photo, with an optional link"],
  ["review", "Review", "A quote from a happy customer"],
  ["button", "Button", "A button on its own"],
  ["visit", "Hours & directions", "Your address, hours, phone, and a directions button"],
  ["divider", "Divider", "A line between sections"],
];
export const blockLabel = (t) => (BLOCK_TYPES.find((b) => b[0] === t) || [t, t])[1];

/* Photos for heroes and images: the same library the website and postcards use */
export const EMAIL_PHOTOS = [
  ["oil", "Oil change"],
  ["general", "Mechanic at work"],
  ["coolant", "Under the hood"],
  ["tires", "Tires"],
  ["brakes", "Brakes"],
  ["trans", "Shifter"],
  ["steering", "Behind the wheel"],
  ["wipers", "Rainy windshield"],
  ["diff", "Pickup truck"],
].map(([key, label]) => {
  const c = key === "general" ? { photo: { id: "1625047509248-ec889cbff17f" } } : SERVICE_CONTENT.find((x) => x.key === key);
  return { id: c.photo.id, label };
});
/* A plain JPEG at the size the email shows it: some mail apps (desktop
   Outlook) can't show WebP or AVIF. */
export const emailPhotoUrl = (idOrUrl, w = 1200, h = 600) => {
  const v = str(idOrUrl);
  if (/^https:\/\//.test(v)) return v;
  if (!v) return "";
  return `https://images.unsplash.com/photo-${v}?w=${w}&h=${h}&fit=crop&crop=entropy&fm=jpg&q=75`;
};

export function newBlock(type) {
  const b = { id: rid(), type };
  switch (type) {
    case "hero":
      return { ...b, photo: EMAIL_PHOTOS[0].id, headline: "Time for an oil change", text: "No appointment needed. Just pull in any time we're open.", buttonLabel: "See our specials", link: "site", url: "" };
    case "text":
      return { ...b, title: "", text: "Hi {first_name},\n\n" };
    case "coupon":
      return { ...b, couponId: "", note: "Show this email at the counter." };
    case "services":
      return { ...b, title: "While you're here", ids: [] };
    case "split":
      return { ...b, photo: EMAIL_PHOTOS[1].id, title: "Honest work, explained plainly", text: "We show you what we find before we fix anything.", buttonLabel: "", link: "site", url: "", flip: false };
    case "image":
      return { ...b, photo: EMAIL_PHOTOS[2].id, caption: "", link: "", url: "" };
    case "review":
      return { ...b, quote: "", name: "", stars: 5 };
    case "button":
      return { ...b, label: "Visit our website", link: "site", url: "" };
    case "visit":
      return { ...b, title: "Come see us" };
    default:
      return b;
  }
}

export const DEFAULT_THEME = { header: "dark", corners: "rounded" };

/* Starting layouts for a new campaign */
export const TEMPLATES = [
  {
    id: "offer",
    name: "Special offer",
    note: "A coupon front and center",
    make: () => ({
      subject: "{first_name}, $20 off your next oil change",
      preheader: "This week only. No appointment needed.",
      blocks: [
        { ...newBlock("hero"), headline: "Save on your next oil change", text: "Fresh oil, a new filter, and a fluid check. In and out, no appointment needed.", buttonLabel: "Get the coupon", link: "offer" },
        newBlock("coupon"),
        { ...newBlock("services"), title: "Add on while you're here" },
        newBlock("visit"),
      ],
    }),
  },
  {
    id: "season",
    name: "Seasonal checkup",
    note: "Get cars ready for the season",
    make: () => ({
      subject: "Is your car ready for the season, {first_name}?",
      preheader: "A quick checkup now saves a breakdown later.",
      blocks: [
        { ...newBlock("hero"), photo: EMAIL_PHOTOS[2].id, headline: "Get ready for the season", text: "Heat, rain, and road trips are hard on a car. A quick checkup catches small problems before they strand you.", buttonLabel: "See our services", link: "site" },
        { ...newBlock("services"), title: "Worth a look this season" },
        { ...newBlock("text"), title: "", text: "Not sure what your car needs? Stop by and we'll take a look, and tell you what can wait." },
        newBlock("visit"),
      ],
    }),
  },
  {
    id: "news",
    name: "New service",
    note: "Announce something new",
    make: () => ({
      subject: "Now at the shop: something new",
      preheader: "Here's what's new.",
      blocks: [
        { ...newBlock("hero"), photo: EMAIL_PHOTOS[1].id, headline: "Something new at the shop", text: "Tell your customers what's new, and why it's good for their car.", buttonLabel: "Learn more", link: "site" },
        newBlock("split"),
        newBlock("button"),
        newBlock("visit"),
      ],
    }),
  },
  {
    id: "thanks",
    name: "Thank you",
    note: "Say thanks and ask for a review",
    make: () => ({
      subject: "Thanks for coming in, {first_name}!",
      preheader: "It means a lot to a local shop.",
      blocks: [
        { ...newBlock("text"), title: "Thanks for choosing us", text: "Hi {first_name},\n\nThanks for trusting us with your car. If anything doesn't seem right, call us and we'll make it right." },
        { ...newBlock("review"), quote: "Honest, fast, and fair. They showed me the old parts before replacing anything.", name: "A happy customer" },
        { ...newBlock("button"), label: "Leave us a review", link: "review" },
      ],
    }),
  },
  { id: "blank", name: "Blank", note: "Start from scratch", make: () => ({ subject: "", preheader: "", blocks: [newBlock("text")] }) },
];

/* ---------- holidays ---------- */

/* nth weekday of a month (weekday 0 = Sunday), or the last one when n < 0 */
const nthDay = (y, month, weekday, n) => {
  if (n > 0) {
    const first = new Date(y, month, 1).getDay();
    return new Date(y, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDate = new Date(y, month + 1, 0);
  return new Date(y, month, lastDate.getDate() - ((lastDate.getDay() - weekday + 7) % 7));
};
/* Western Easter (anonymous Gregorian algorithm) */
const easter = (y) => {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  return new Date(y, month, ((h + l - 7 * m + 114) % 31) + 1);
};
const thanksgiving = (y) => nthDay(y, 10, 4, 4);
const plusDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/* A holiday layout: hero with its own photo and headline, the coupon you
   pick, and whatever fits the day. `color` tints buttons and the coupon. */
const holiday = (id, name, date, color, photo, sendNote, subject, preheader, headline, text, button, extra = []) => ({
  id,
  name,
  group: "holiday",
  date,
  color,
  sendNote,
  note: sendNote,
  make: () => ({
    subject,
    preheader,
    theme: { header: "dark", corners: "rounded", color },
    blocks: [{ ...newBlock("hero"), photo, headline, text, buttonLabel: button, link: "offer" }, newBlock("coupon"), ...extra.map((x) => ({ ...newBlock(x.type), ...x })), newBlock("visit")],
  }),
});
const svc = (title) => ({ type: "services", title, ids: [] });
const txt = (title, text) => ({ type: "text", title, text });

export const HOLIDAYS = [
  holiday("newyear", "New Year's", (y) => new Date(y, 0, 1), "#1e3a8a", "1608416026650-66b4e0c0c301", "Send the week between Christmas and New Year's",
    "New year, fresh oil, {first_name}", "Start the year off right: a little something for your first visit of the year.",
    "New year, fresh start", "Start the year with a fresh oil change and a quick look at what your car needs. We'll tell you what's urgent and what can wait.", "Claim your New Year's deal",
    [svc("Start the year right")]),
  holiday("valentine", "Valentine's Day", (y) => new Date(y, 1, 14), "#c2185b", "1516822477961-1427b7790e80", "Send about a week before",
    "Show your car some love, {first_name}", "A little love for the car that gets you everywhere.",
    "Show your car some love", "It gets you to work, to dinner, and home again. Treat it to a fresh oil change and a checkup this week.", "Get the Valentine's deal"),
  holiday("presidents", "Presidents' Day", (y) => nthDay(y, 1, 1, 3), "#1d3f8f", "1719837235121-9b1dba350e8b", "Send a few days before the long weekend",
    "Presidents' Day savings, {first_name}", "A long-weekend deal on the service your car needs.",
    "Presidents' Day savings", "Long weekend coming up? Get your car checked before you head out, and save while you're at it.", "See the deal",
    [svc("Before the long weekend")]),
  holiday("stpatricks", "St. Patrick's Day", (y) => new Date(y, 2, 17), "#1f8a4c", "1648013422243-17afe1ae1439", "Send about a week before",
    "Feeling lucky, {first_name}?", "No luck needed: savings on your next service.",
    "Feeling lucky?", "You don't need a four-leaf clover to save on your next oil change. Just this email.", "Get lucky"),
  holiday("spring", "Easter & spring", (y) => easter(y), "#2f855a", "1590523841726-8503b8baa88c", "Send in early spring, a week or two before Easter",
    "Spring checkup time, {first_name}", "Wipers, A/C, and tires: get ready for the warm months.",
    "Spring checkup", "Winter is hard on a car. Spring is the time to swap worn wipers, check the A/C before the heat, and look over the tires.", "Book your spring checkup",
    [svc("Spring checklist")]),
  holiday("mothers", "Mother's Day", (y) => nthDay(y, 4, 0, 2), "#c2185b", "1619962992057-be492a5816f6", "Send about 10 days before",
    "A gift Mom will actually use", "Treat Mom to a service she doesn't have to think about.",
    "A gift Mom will actually use", "Flowers are nice. A fresh oil change and a safety check on her car is something she'll thank you for all year.", "Get the Mother's Day deal"),
  holiday("memorial", "Memorial Day", (y) => nthDay(y, 4, 1, -1), "#1d3f8f", "1561061715-ad0d1ade0b73", "Send the week before the long weekend",
    "Road-trip ready for Memorial Day, {first_name}?", "A quick pre-trip check before the long weekend.",
    "Road-trip ready?", "Heading out for the long weekend? We'll check your fluids, tires, brakes, and wipers so the only surprise is how good the trip is.", "Get the pre-trip deal",
    [svc("Before you hit the road")]),
  holiday("fathers", "Father's Day", (y) => nthDay(y, 5, 0, 3), "#1f4e79", "1708745427274-d5de5122fd57", "Send about 10 days before",
    "The gift Dad really wants: less time under the hood", "Treat Dad to a service on us.",
    "For the dad who does it himself", "Give Dad a break from the driveway. Treat him to an oil change and a checkup done right.", "Get the Father's Day deal"),
  holiday("july4", "4th of July", (y) => new Date(y, 6, 4), "#b91c1c", "1533230408708-8f9f91d1235a", "Send the week before",
    "4th of July road trip? Get ready, {first_name}", "Fireworks are for the sky, not your dashboard.",
    "Fireworks in the sky, not on the dash", "Summer heat and holiday traffic are tough on a car. A quick check before the 4th keeps your trip on track.", "Get the 4th of July deal",
    [svc("Summer-ready")]),
  holiday("labor", "Labor Day", (y) => nthDay(y, 8, 1, 1), "#c2410c", "1526478512290-5397e7d2ca6a", "Send the week before the long weekend",
    "Labor Day savings, {first_name}", "One last summer road trip? Get ready first.",
    "End-of-summer savings", "Squeeze in one more trip, then get ready for fall. Save on the service your car is due for.", "See the deal",
    [svc("End-of-summer checkup")]),
  holiday("halloween", "Halloween", (y) => new Date(y, 9, 31), "#ea580c", "1508361001413-7a9dca21d08a", "Send about a week before",
    "No tricks, just treats, {first_name}", "A treat for your car this Halloween.",
    "No tricks, just treats", "The only scary thing about your car should be the costume in the passenger seat. Here's a treat for your next service.", "Get your treat"),
  holiday("veterans", "Veterans Day", (y) => new Date(y, 10, 11), "#1d3f8f", "1618420138990-25842589a7c4", "Send a few days before",
    "Thank you for your service", "A thank-you to the veterans and service members we serve.",
    "Thank you for your service", "To every veteran and service member: thank you. Please accept this as a small thank-you from all of us.", "Claim your thank-you",
    [txt("", "Good for veterans and active military. Please show your military or veteran ID at the counter.")]),
  holiday("thanksgiving", "Thanksgiving", (y) => thanksgiving(y), "#9a3412", "1476820865390-c52aeebb9891", "Send the week before",
    "Driving to Thanksgiving, {first_name}?", "A quick safety check before the busiest travel week of the year.",
    "Get there safely", "Thanksgiving week is the busiest travel week of the year. We'll check the essentials so you get to the table on time.", "Get the pre-trip deal",
    [txt("", "We're thankful for customers like you. From all of us at the shop, have a wonderful Thanksgiving.")]),
  holiday("blackfriday", "Black Friday", (y) => plusDays(thanksgiving(y), 1), "#e11d48", "1607083206968-13611e3d76db", "Send the Monday before, and again on Friday",
    "Black Friday: our biggest deals of the year", "Our best prices of the year. This week only.",
    "Our biggest deals of the year", "Black Friday deals aren't just for TVs. Save big on the service your car needs, this week only.", "Shop the Black Friday deals",
    [svc("Black Friday specials")]),
  holiday("cybermonday", "Cyber Monday", (y) => plusDays(thanksgiving(y), 4), "#2563eb", "1563013544-824ae1b704d3", "Send Monday morning",
    "Cyber Monday: claim this deal online, {first_name}", "One tap to claim it. Use it any time this month.",
    "A Cyber Monday deal, no line required", "Claim it online today and use it any time this month. It's that easy.", "Claim it online"),
  holiday("christmas", "Christmas & holidays", (y) => new Date(y, 11, 25), "#b91c1c", "1611170956202-1b69ae8da30a", "Send in early December",
    "Holiday travel ahead, {first_name}?", "Get your car ready for holiday trips (and cold mornings).",
    "Ready for holiday travel?", "Cold mornings and long drives to family are tough on a car. A quick checkup now saves a breakdown on the way to grandma's.", "Get the holiday deal",
    [svc("Before the holidays"), txt("", "From all of us at the shop: happy holidays, and thank you for a great year.")]),
];

/* The next date a holiday falls on, from `now` (today counts) */
export function nextDate(h, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = h.date(today.getFullYear());
  return d >= today ? d : h.date(today.getFullYear() + 1);
}
/* holidays in the order they come up next */
export function upcomingHolidays(now = new Date()) {
  return HOLIDAYS.map((h) => ({ ...h, next: nextDate(h, now) })).sort((a, b) => a.next - b.next);
}

/* Emails written before blocks existed (headline, body, coupon, button)
   become blocks, so every saved campaign and automation keeps working. */
export function specBlocks(spec) {
  if (spec && Array.isArray(spec.blocks) && spec.blocks.length) return spec.blocks;
  const s = spec || {};
  const out = [];
  if (str(s.headline) || str(s.body)) out.push({ id: "t1", type: "text", title: str(s.headline), text: str(s.body) });
  if (s.couponId) out.push({ id: "c1", type: "coupon", couponId: s.couponId, note: "Show this email at the counter." });
  const kind = s.button || "";
  if (kind) out.push({ id: "b1", type: "button", label: str(s.buttonLabel), link: kind === "custom" ? "custom" : kind === "review" ? "review" : s.couponId ? "offer" : "site", url: str(s.buttonUrl) });
  return out;
}
