/* What each service's page on the shop website says: why it matters, the
   signs a car needs it, and what the shop does. Written for drivers, not
   techs — plain words, no part numbers. Pure data plus a lookup.

   Matched to a service-menu button by its name/category, so any shop's menu
   finds its page. "How often" is not written here: it comes from the shop's
   own Service Review intervals (cfg.serviceIntervals) via `intervalId`.

   Photos are free-to-use Unsplash images (unsplash.com/license), hot-linked
   from images.unsplash.com as Unsplash asks; `by` is the photographer, who
   gets a credit line on the page. */

export const SERVICE_CONTENT = [
  {
    key: "brakeFluid",
    match: /brake fluid/i,
    intervalId: "brakeFluid",
    photo: { id: "1640291168317-9d962e809022", by: "Rafael Hoyos Weht" },
    headline: "A firm pedal, every time",
    intro:
      "Brake fluid carries the push of your foot to the brakes at each wheel. It slowly soaks up moisture from the air, and wet fluid boils sooner and rusts the brake parts from the inside. Fresh fluid keeps the pedal firm and protects the expensive parts, like the ABS unit.",
    benefits: [
      ["Firm, confident pedal", "No soft or spongy feel when you need to stop."],
      ["Protects the ABS", "Clean fluid keeps rust out of the parts that cost the most to replace."],
      ["Safer on hills", "Fresh fluid won't boil under hard braking coming down a grade."],
      ["Cheap insurance", "A flush costs a fraction of a caliper or ABS repair."],
    ],
    symptoms: ["Brakes feel soft or mushy", "Pedal sinks toward the floor", "Fluid looks dark instead of clear amber", "It's been two years or more since the last flush", "Brake or ABS light is on"],
    included: ["Test the fluid for moisture", "Push the old fluid out of every brake line", "Refill with the fluid your car calls for", "Bleed out any air and check the pedal", "Road test"],
  },
  {
    key: "oil",
    match: /oil|lube/i,
    intervalId: "oil",
    photo: { id: "1487754180451-c456f719a1fc", by: "Tim Mossholder" },
    headline: "Keep your engine clean, cool, and protected",
    intro:
      "Oil keeps hundreds of fast-moving metal parts from grinding against each other. Over time it breaks down and fills with dirt, and worn-out oil can't do its job. A fresh change with the right oil for your engine is the cheapest insurance you can buy for your car.",
    benefits: [
      ["Longer engine life", "Clean oil means less wear on the parts that are the most expensive to fix."],
      ["Better gas mileage", "Fresh oil flows easily, so the engine doesn't work as hard."],
      ["Keeps your warranty good", "Carmakers require regular oil changes to keep the engine warranty valid."],
      ["A quick look-over", "We check and top off your fluids while we're under the hood."],
    ],
    symptoms: ["Oil light or maintenance reminder is on", "You're past the date or miles on your window sticker", "Oil looks dark and gritty on the dipstick", "Engine sounds louder or ticks", "Oil spot under the car", "Burning oil smell"],
    included: ["Drain the old oil", "Install a new oil filter", "Refill with the right grade and amount for your engine", "Check and top off your fluids", "Reset your maintenance reminder"],
  },
  {
    key: "brakes",
    match: /brake/i,
    photo: { id: "1760317890322-364a810cd4da", by: "Erik Mclean" },
    headline: "Stop sooner, and stop worrying",
    intro:
      "Every time you stop, your brake pads squeeze the rotors and wear down a little. Replacing pads on time keeps stopping distances short, and it saves your rotors from damage, which is a much bigger bill.",
    benefits: [
      ["Shorter stops", "Good pads and smooth rotors stop you faster, especially in an emergency."],
      ["Save on rotors", "Catching worn pads early keeps them from grinding into the rotors."],
      ["Quiet, smooth braking", "No squeal, no grind, no shaking pedal."],
      ["We show you first", "You see the measurements and worn parts before we replace anything."],
    ],
    symptoms: ["Squealing when you brake", "Grinding when you brake", "Brake pedal shakes or pulses", "Pulls to one side when you brake", "Takes longer to stop than it should", "Brake light is on"],
    included: ["Measure the pads and check the rotors", "Replace pads, and rotors if they need it", "Clean and grease the slides and hardware", "Check the brake fluid and lines", "Road test"],
  },
  {
    key: "tires",
    match: /tire|wheel|align/i,
    intervalId: "tireRotate",
    photo: { id: "1764015805414-df7de89d405b", by: "Lex" },
    headline: "Grip you can count on",
    intro:
      "Your tires are the only thing touching the road. Good tread, the right pressure, and even wear mean shorter stops, better handling in the rain, and tires that last thousands of miles longer.",
    benefits: [
      ["Safer in the rain", "Deep tread clears water so the tire keeps its grip."],
      ["Tires last longer", "Rotating on schedule evens out wear across all four."],
      ["Better gas mileage", "Properly inflated tires roll easier."],
      ["Smooth, quiet ride", "Balanced wheels don't shake the steering wheel at speed."],
    ],
    symptoms: ["Low tire pressure light is on", "Shaking that gets worse with speed", "Tires wearing unevenly", "Tread is getting low", "Nail or screw in a tire", "Tire keeps going flat"],
    included: ["Check tread and pressure on all four", "Mount and balance new tires", "Rotate to even out wear", "Patch flats when it's safe to repair", "Set pressures to your car's spec"],
  },
  {
    key: "cabin",
    match: /cabin/i,
    intervalId: "cabinAir",
    photo: { id: "1542399204-b8dd4af5113d", by: "Olav Tvedt" },
    headline: "Cleaner air inside your car",
    intro:
      "The cabin filter cleans the air that comes through your vents: dust, pollen, and exhaust soot from the car ahead. When it clogs, the A/C and heat get weaker and the car can start to smell musty.",
    benefits: [
      ["Less dust and pollen", "A big help if anyone in the car has allergies."],
      ["Stronger airflow", "Air moves freely, so the A/C and heat work better."],
      ["Fresher smell", "No more musty air when you turn on the fan."],
      ["Easier on the blower", "The fan motor doesn't strain to push air through."],
    ],
    symptoms: ["Bad or musty smell from the vents", "Weak air from the vents", "Windows fog up and are slow to clear", "More sneezing when you drive", "Not replaced in over a year"],
    included: ["Pull and inspect the filter", "Show you the old one", "Install a new filter", "Check the airflow from the vents"],
  },
  {
    key: "air",
    match: /air filter|^air/i,
    intervalId: "engineAir",
    photo: { id: "1779174682243-2fb7a6617316", by: "Назарій Ковальов" },
    headline: "Let your engine breathe",
    intro:
      "Your engine pulls in thousands of gallons of air for every gallon of gas it burns. The air filter keeps dust and grit out. When it clogs, the engine has to work harder for every mile.",
    benefits: [
      ["Protects the engine", "Keeps dirt out of the cylinders, where it causes wear."],
      ["Strong acceleration", "A clean filter lets the engine get all the air it needs."],
      ["Helps fuel economy", "Especially on older cars, a clogged filter can cost you at the pump."],
      ["See it yourself", "We show you the old filter so you know it needed changing."],
    ],
    symptoms: ["Filter looks gray or dirty", "Feels weak or sluggish", "Using more gas than usual", "You drive on dusty roads", "Not replaced in over a year"],
    included: ["Pull and inspect the filter", "Show you the old one", "Clean out the filter box", "Install a new filter"],
  },
  {
    key: "wipers",
    match: /wiper/i,
    intervalId: "wipers",
    photo: { id: "1508786250378-b165238d6e8b", by: "Thibault Valjevac" },
    headline: "See clearly when it rains",
    intro:
      "Sun and heat harden the rubber on wiper blades, so they streak and chatter long before they look worn. Most people find out on the first rainy day. New blades take minutes.",
    benefits: [
      ["Clear view in the rain", "A clean sweep every pass, no streaks across your line of sight."],
      ["Quiet", "No chattering or squeaking across the glass."],
      ["Protects the windshield", "Worn blades can scratch the glass."],
      ["Done while you wait", "Installed in a few minutes."],
    ],
    symptoms: ["Streaks or smears", "Chattering or skipping across the glass", "Squeaking", "Rubber is cracked or torn", "Leaves patches it doesn't wipe"],
    included: ["Check the blades and arms", "Install new blades sized for your car", "Top off the washer fluid", "Test them"],
  },
  {
    key: "trans",
    match: /trans|clutch/i,
    intervalId: "trans",
    photo: { id: "1606128031531-52ae98c9707a", by: "Maxim Hopman" },
    headline: "Smooth shifts and a longer-lasting transmission",
    intro:
      "Transmission fluid cools, cleans, and lubricates the gears and clutches inside. As it ages it breaks down and runs hotter, and heat is what wears transmissions out. A fluid service costs a small fraction of a transmission repair.",
    benefits: [
      ["Smoother shifts", "Fresh fluid helps the transmission shift the way it did when it was new."],
      ["Runs cooler", "Heat is the number one cause of transmission trouble."],
      ["Avoid a big bill", "Fluid is cheap. A rebuilt transmission isn't."],
      ["Tow with confidence", "Especially important if you tow or haul."],
    ],
    symptoms: ["Shifts hard or rough", "Jerks or shudders", "Slow to move when you press the gas", "Revs up but doesn't speed up", "Red puddle under the car", "Burning smell"],
    included: ["Check the fluid's condition and level", "Drain or exchange the old fluid", "Refill with the fluid your transmission calls for", "Check for leaks", "Road test"],
  },
  {
    key: "coolant",
    match: /radiator|coolant|cool/i,
    intervalId: "coolant",
    photo: { id: "1713757553447-f8f092417cf9", by: "Tory Hoffman" },
    headline: "Keep your engine from overheating",
    intro:
      "Coolant carries heat away from the engine and keeps rust out of the cooling system. Old coolant loses that protection. A flush costs far less than a new radiator, water pump, or a head gasket from overheating.",
    benefits: [
      ["No overheating", "Keeps the engine at the right temperature in traffic and heat."],
      ["Stops rust", "Fresh coolant protects the radiator, hoses, and water pump."],
      ["Heater works right", "Good coolant flow means warm air in winter."],
      ["Avoid major repairs", "Overheating can ruin an engine in minutes."],
    ],
    symptoms: ["Temperature gauge running high", "Running hot or overheating", "Green or orange puddle under the car", "Sweet, syrupy smell", "Heat isn't warm", "Coolant looks rusty or dirty"],
    included: ["Pressure-test for leaks", "Flush out the old coolant", "Refill with the type your car calls for", "Bleed air from the system", "Check the hoses and radiator cap"],
  },
  {
    key: "fuel",
    match: /fuel/i,
    photo: { id: "1644246905181-c3753e9a82bd", by: "engin akyurt" },
    headline: "Get back the power and mileage you used to have",
    intro:
      "Over time, carbon builds up in the fuel injectors and intake, so the engine gets a poorer spray of fuel and runs less efficiently. A fuel system cleaning breaks those deposits down.",
    benefits: [
      ["Smoother idle", "Less shaking at stoplights."],
      ["Better mileage", "Clean injectors spray fuel the way they're designed to."],
      ["Easier starts", "Especially on cold mornings."],
      ["Cleaner exhaust", "Helps the engine burn fuel completely."],
    ],
    symptoms: ["Stumbles or hesitates when you give it gas", "Shakes or rattles when stopped", "Using more gas than usual", "Takes a while to start", "Feels weak or sluggish"],
    included: ["Run a professional cleaner through the fuel system", "Clean the throttle body", "Treat the fuel in the tank", "Road test"],
  },
  {
    key: "steering",
    match: /steer|susp/i,
    intervalId: "psFluid",
    photo: { id: "1515086828834-023d61380316", by: "Jessica Furtney" },
    headline: "Easy, quiet steering",
    intro:
      "Power steering fluid is what lets you turn the wheel with one hand. Worn-out fluid wears the pump and seals, and makes steering stiff and noisy.",
    benefits: [
      ["Easy steering", "Parking and tight turns without the workout."],
      ["No whining", "Fresh fluid quiets a noisy pump."],
      ["Protects the pump", "Clean fluid keeps the pump and steering rack from wearing out."],
      ["Fewer leaks", "Keeps the seals soft and sealing."],
    ],
    symptoms: ["Hard to steer", "Whining when you turn the wheel", "Steering feels stiff when it's cold", "Fluid looks dark", "Reddish puddle near the front of the car"],
    included: ["Check the fluid and look for leaks", "Flush out the old fluid", "Refill with the fluid your car calls for", "Turn lock to lock to bleed the air", "Road test"],
  },
  {
    key: "diff",
    match: /diff|axle|gear/i,
    intervalId: "diff",
    photo: { id: "1551830820-330a71b99659", by: "Caleb White" },
    headline: "Protect the gears that drive your wheels",
    intro:
      "Trucks, SUVs, and all-wheel-drive cars have differentials that split power between the wheels. The gear oil inside takes a beating, especially when you tow or haul, and it doesn't last forever.",
    benefits: [
      ["Longer gear life", "Fresh gear oil keeps metal from wearing on metal."],
      ["Quiet driving", "Worn oil can lead to a hum or whine at speed."],
      ["Tow with confidence", "Heavy loads heat the gear oil fastest."],
      ["Avoid a rebuild", "Replacing gears costs many times more than the oil."],
    ],
    symptoms: ["Humming or whining that changes with speed", "Clunk when you take off", "You tow or haul often", "Leak near the axles", "It's never been changed"],
    included: ["Drain the old gear oil", "Check it for metal wear", "Refill with the right gear oil", "Check the seals for leaks"],
  },
];

/* The general page for a service with no content of its own. */
export const GENERIC_CONTENT = {
  key: "general",
  photo: { id: "1625047509248-ec889cbff17f", by: "Kate Ibragimova" },
  headline: "Done right, explained plainly",
  intro: "We look first, tell you what we found in plain words, and give you a written price before any work starts.",
  benefits: [
    ["Straight answers", "What needs fixing now, and what can wait."],
    ["Price up front", "A written estimate before we start."],
    ["Quality parts", "Parts that fit and last, with a warranty."],
    ["We show you", "You're welcome to see the old parts."],
  ],
  symptoms: [],
  included: ["Inspect and diagnose", "Explain what we found", "Written estimate before any work", "Do the job and road test"],
};

export function serviceContent(name) {
  return SERVICE_CONTENT.find((c) => c.match.test(String(name || ""))) || GENERIC_CONTENT;
}

export const photoUrl = (id, w = 1600) => `https://images.unsplash.com/photo-${id}?w=${w}&q=70&auto=format&fit=crop`;
