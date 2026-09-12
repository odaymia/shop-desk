"""Reader for ISI LubeSoft data tables (data/<name>.dat + <name>.tag).

Layout worked out from the files themselves:
  header      0x9a  uint16 record length
              0xa5  field count
              0x2d0 table name
              0x2e0 field table, 8 bytes each: uint16 offset (1-based), byte
                    type (high nibble = index number, low nibble = decimals),
                    byte length, byte kind (0 alpha, 1 number, 2 date, 3 overlay)
  data        starts at 3072. Records <= 512 bytes are packed into 512-byte
              pages without crossing a page edge; longer records are contiguous.
  numbers     packed BCD, big-endian digits. The first nibble is the first
              digit + 1; a first nibble of 0 with digits after it means the
              value is negative (all zero = never set). Decimals from the
              type byte's low nibble: 0 none, 1 two, 2 four.
  dates       3 bytes, same packing: day count from 1916-06-30.
  deleted     a free record is all zero after its free-list link.
"""
import os, struct, datetime

DATA_START = 3072
PAGE = 512
EPOCH = datetime.date(1916, 6, 30)
DECIMALS = {0: 0, 1: 2, 2: 4, 4: 2}  # type low nibble -> implied decimals (verified: 1 money, 2 cost/COG/percent-as-fraction)

class Field:
    __slots__ = ("name", "off", "len", "kind", "key", "dec")
    def __init__(self, name, off, typ, ln, kind):
        self.name, self.off, self.len, self.kind = name, off - 1, ln, kind
        self.key, self.dec = typ >> 4, typ & 0xF
    def __repr__(self): return f"{self.name}@{self.off}+{self.len} k{self.kind}"

def bcd_digits(b):
    """digits of a packed field, first nibble decoded as digit+1; None if unset"""
    if not b or (b[0] >> 4) == 0: return None
    out = [str((b[0] >> 4) - 1), str(b[0] & 0xF)]
    for x in b[1:]: out.append(f"{x >> 4}{x & 0xF}")
    return "".join(out)

class Table:
    def __init__(self, root, name):
        self.name = name
        self.path = os.path.join(root, "data", name + ".dat")
        tagp = os.path.join(root, name + ".tag")
        tags = [l.strip() for l in open(tagp, encoding="latin1")] if os.path.exists(tagp) else []
        tags = [t for t in tags if t]
        self.f = open(self.path, "rb")
        h = self.f.read(4096)
        self.reclen = struct.unpack_from("<H", h, 0x9a)[0]
        self.nfields = h[0xa5]
        self.label = h[0x2d0:0x2e0].rstrip(b"\0").decode("latin1")
        self.fields = []
        for i in range(self.nfields):
            off, typ, ln, kind = struct.unpack_from("<HBBB", h, 0x2e0 + 8 * i)
            self.fields.append(Field(tags[i] if i < len(tags) else f"F{i+1}", off, typ, ln, kind))
        self.byname = {f.name: f for f in self.fields}
        self.size = os.path.getsize(self.path)
        if self.reclen <= PAGE:
            self.per_page = PAGE // self.reclen
            self.nrec = ((self.size - DATA_START) // PAGE) * self.per_page + min(self.per_page, ((self.size - DATA_START) % PAGE) // self.reclen)
        else:
            self.per_page = 0
            self.nrec = (self.size - DATA_START) // self.reclen

    def offset(self, n):
        """byte offset of LubeSoft record number n (slot 0 at DATA_START is never used)"""
        i = n
        if self.per_page:
            return DATA_START + (i // self.per_page) * PAGE + (i % self.per_page) * self.reclen
        return DATA_START + i * self.reclen

    def raw(self, n):
        self.f.seek(self.offset(n))
        return self.f.read(self.reclen)

    @staticmethod
    def is_free(b):
        return not b or not any(b[4:])

    def decode(self, b, names=None):
        rec = {}
        for fl in self.fields:
            if fl.kind == 3: continue
            if names and fl.name not in names: continue
            rec[fl.name] = self.value(fl, b)
        return rec

    def value(self, fl, b):
        raw = b[fl.off:fl.off + fl.len]
        if fl.kind == 0:
            return raw.decode("latin1").rstrip(" \0")
        if fl.kind == 1:
            if not raw: return None
            neg = (raw[0] >> 4) == 0
            d = (str(raw[0] & 0xF) + "".join(f"{x >> 4}{x & 0xF}" for x in raw[1:])) if neg else bcd_digits(raw)
            if not d.isdigit(): return ("?", raw.hex())
            n = int(d)
            if neg:
                if n == 0: return None
                n = -n
            dec = DECIMALS.get(fl.dec, fl.dec)
            return round(n / (10 ** dec), dec) if dec else n
        if fl.kind == 2:
            if len(raw) < 3 or (raw[0] >> 4) == 0: return None
            d = f"{raw[0] & 0xF}{raw[1]:02x}{raw[2]:02x}"
            if not d.isdigit() or int(d) == 0: return None
            try: return EPOCH + datetime.timedelta(days=int(d))
            except OverflowError: return None
        return raw.hex()

    def records(self, names=None, start=1, stop=None):
        """yield (recno, dict) for live records"""
        stop = stop or self.nrec - 1
        for n in range(start, stop + 1):
            b = self.raw(n)
            if len(b) < self.reclen or self.is_free(b): continue
            yield n, self.decode(b, names)

def fmt(rec):
    return {k: (v.isoformat() if isinstance(v, datetime.date) else v) for k, v in rec.items() if v not in ("", None, 0, 0.0)}
