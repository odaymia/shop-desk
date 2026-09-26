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
