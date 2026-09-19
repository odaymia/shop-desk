import { test } from "node:test";
import assert from "node:assert/strict";
import { isHazmatFee, authRecordText, reauthText, isAuthorized, needsReauth, complianceWarnings } from "../src/lib/compliance.js";

const when = () => "Sep 19, 2026 2:15 PM";

test("isHazmatFee catches disposal/hazardous fee lines only", () => {
  assert.ok(isHazmatFee({ kind: "fee", description: "Hazardous waste disposal" }));
  assert.ok(isHazmatFee({ kind: "fee", description: "Tire disposal fee" }));
  assert.ok(!isHazmatFee({ kind: "fee", description: "Shop equipment fee" }));
  assert.ok(!isHazmatFee({ kind: "part", description: "Oil disposal tray" }));
});

test("authRecordText reads as a proper authorization record", () => {
  assert.equal(
    authRecordText({ name: "Maria Alvarez", method: "phone", contact: "(619) 555-0100", at: 1, advisor: "Sam" }, when),
    "Authorized by Maria Alvarez by phone on Sep 19, 2026 2:15 PM ((619) 555-0100); recorded by Sam.",
  );
  assert.equal(authRecordText({ name: "Jo", method: "in-person", at: 1 }, when), "Authorized by Jo in person on Sep 19, 2026 2:15 PM.");
  assert.equal(authRecordText(null), "");
  assert.equal(authRecordText({ name: "  " }), "");
});

test("reauthText frames additional work and the revised total", () => {
  const s = reauthText({ name: "Maria Alvarez", method: "phone", at: 1, note: "approved rear brakes too", newTotal: 640.5 }, when);
  assert.match(s, /^Additional work authorized by Maria Alvarez by phone/);
  assert.match(s, /approved rear brakes too\./);
  assert.match(s, /Revised total: \$640\.50\./);
});

test("isAuthorized true for a signature or a recorded oral auth", () => {
  assert.ok(isAuthorized({ signatures: { authorization: { img: "data:...", name: "X" } } }));
  assert.ok(isAuthorized({ auth: { name: "X", method: "phone" } }));
  assert.ok(!isAuthorized({}));
  assert.ok(!isAuthorized({ signatures: { authorization: { name: "X" } } })); // name but no image = not signed
});

test("needsReauth fires only once authorized and the total climbs past it", () => {
  assert.ok(!needsReauth({}, 500)); // never authorized
  assert.ok(!needsReauth({ authorizedTotal: 500 }, 500));
  assert.ok(needsReauth({ authorizedTotal: 500 }, 560));
  assert.ok(!needsReauth({ authorizedTotal: 500 }, 499));
});

test("complianceWarnings flags the common BAR gaps", () => {
  // authorized (signed) at $100, now $260, with a disposal fee but no EPA ID
  const order = { authorizedTotal: 100, signatures: { authorization: { img: "x", name: "Y" } }, lines: [{ kind: "fee", description: "Hazardous waste disposal" }] };
  const w = complianceWarnings(order, {}, 260);
  assert.equal(w.length, 2); // over the authorized total + hazmat fee without an EPA ID
  // authorized with a signature and EPA id set, total within approval → clean
  const ok = complianceWarnings(
    { authorizedTotal: 300, signatures: { authorization: { img: "x", name: "Y" } }, lines: [{ kind: "fee", description: "Hazardous waste disposal" }] },
    { epaId: "CAL000123456" },
    300,
  );
  assert.deepEqual(ok, []);
});
