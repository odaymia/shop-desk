"""Read a Mitchell1 Manager SE backup (.bak = SQL Server, uncompressed) with
no SQL Server: find the 8 KB pages, decode the system catalog, then walk
each table's data pages and decode the rows.

Page and record layouts follow the public descriptions of the SQL Server
storage engine (Paul Randal's "Anatomy of a page/record", OrcaMDF).
"""
import struct, collections, datetime, decimal, uuid

PAGE = 8192
PAGE_TYPES = {1: "data", 2: "index", 3: "textmix", 4: "texttree", 8: "GAM", 9: "SGAM", 10: "IAM",
              11: "PFS", 13: "boot", 15: "filehdr", 16: "diffmap", 17: "mlmap"}


class Page:
    __slots__ = ("off", "type", "objId", "indexId", "slotCnt", "pageId", "fileId", "level", "flagBits", "nextPage", "prevPage")

    def __init__(self, off, b):
        self.off = off
        self.type = b[1]
        self.level = b[3]
        self.flagBits = struct.unpack_from("<H", b, 4)[0]
        self.indexId = struct.unpack_from("<H", b, 6)[0]
        self.prevPage = (struct.unpack_from("<i", b, 8)[0], struct.unpack_from("<H", b, 12)[0])
        self.nextPage = (struct.unpack_from("<i", b, 16)[0], struct.unpack_from("<H", b, 20)[0])
        self.slotCnt = struct.unpack_from("<H", b, 22)[0]
        self.objId = struct.unpack_from("<i", b, 24)[0]
        self.pageId = struct.unpack_from("<i", b, 32)[0]
        self.fileId = struct.unpack_from("<H", b, 36)[0]

    @property
    def allocUnitId(self):
        return (self.objId << 16) | (self.indexId << 48)


class Bak:
    def __init__(self, path):
        self.data = open(path, "rb").read()
        self.pages = []
        self.byPageId = {}  # (fileId, pageId) -> Page (last one wins: a backup can hold a page twice)
        self.byAlloc = collections.defaultdict(list)
        self._scan()

    def _scan(self):
        d = self.data
        n = len(d)
        off = 0
        while off + PAGE <= n:
            b = d[off:off + 64]
            if b[0] == 1 and b[1] in PAGE_TYPES:
                freeData = struct.unpack_from("<H", b, 30)[0]
                slot = struct.unpack_from("<H", b, 22)[0]
                fileId = struct.unpack_from("<H", b, 36)[0]
                pageId = struct.unpack_from("<i", b, 32)[0]
                objId = struct.unpack_from("<i", b, 24)[0]
                if 96 <= freeData <= PAGE and slot <= 1500 and 1 <= fileId <= 4 and 0 <= pageId < 10_000_000 and objId >= 0:
                    p = Page(off, b)
                    self.pages.append(p)
                    self.byPageId[(p.fileId, p.pageId)] = p
                    if p.type in (1, 2, 3, 4):
                        self.byAlloc[p.allocUnitId].append(p)
                    off += PAGE
                    continue
            off += 512

    def page_bytes(self, p):
        return self.data[p.off:p.off + PAGE]

    def records(self, p):
        """Yield raw record bytes for each slot on a page, in slot order."""
        b = self.page_bytes(p)
        for i in range(p.slotCnt):
            so = struct.unpack_from("<H", b, PAGE - 2 * (i + 1))[0]
            if so == 0 or so >= PAGE:
                continue
            yield so, b[so:]

    def data_pages(self, allocUnitId):
        """Leaf data pages of an allocation unit, deduplicated by page id."""
        seen = set()
        out = []
        for p in self.byAlloc.get(allocUnitId, []):
            if p.type == 1 and p.level == 0 and (p.fileId, p.pageId) not in seen:
                seen.add((p.fileId, p.pageId))
                out.append(p)
        return out


# ---------------- record decoding ----------------

class Col:
    def __init__(self, name, xtype, length=0, prec=0, scale=0, nullable=True):
        self.name, self.xtype, self.length, self.prec, self.scale, self.nullable = name, xtype, length, prec, scale, nullable

    @property
    def fixed(self):
        return self.xtype not in VARIABLE_TYPES


# xtype ids from sys.types
INT, BIGINT, SMALLINT, TINYINT, BIT = 56, 127, 52, 48, 104
DECIMAL, NUMERIC, MONEY, SMALLMONEY, FLOAT, REAL = 106, 108, 60, 122, 62, 59
DATETIME, SMALLDATETIME, DATE, TIME, DATETIME2, DATETIMEOFFSET = 61, 58, 40, 41, 42, 43
CHAR, VARCHAR, NCHAR, NVARCHAR, TEXT, NTEXT = 175, 167, 239, 231, 35, 99
BINARY, VARBINARY, IMAGE, UNIQUEIDENTIFIER, XML, SQL_VARIANT, SYSNAME, TIMESTAMP = 173, 165, 34, 36, 241, 98, 256, 189
VARIABLE_TYPES = {VARCHAR, NVARCHAR, VARBINARY, TEXT, NTEXT, IMAGE, XML, SQL_VARIANT, SYSNAME}


def fixed_size(c):
    t = c.xtype
    if t == INT: return 4
    if t == BIGINT: return 8
    if t == SMALLINT: return 2
    if t == TINYINT: return 1
    if t == BIT: return 0  # packed into the fixed area bit by bit; handled specially
    if t in (DECIMAL, NUMERIC):
        p = c.prec
        return 5 if p <= 9 else 9 if p <= 19 else 13 if p <= 28 else 17
    if t == MONEY: return 8
    if t == SMALLMONEY: return 4
    if t == FLOAT: return 8 if c.length in (0, 8) else 4
    if t == REAL: return 4
    if t == DATETIME: return 8
    if t == SMALLDATETIME: return 4
    if t == DATE: return 3
    if t == TIME: return 3 if c.scale <= 2 else 4 if c.scale <= 4 else 5
    if t == DATETIME2: return 6 if c.scale <= 2 else 7 if c.scale <= 4 else 8
    if t == DATETIMEOFFSET: return 8 if c.scale <= 2 else 9 if c.scale <= 4 else 10
    if t in (CHAR, BINARY, NCHAR): return c.length
    if t == UNIQUEIDENTIFIER: return 16
    if t == TIMESTAMP: return 8
    raise ValueError("unknown fixed type %d" % t)


EPOCH = datetime.datetime(1900, 1, 1)


def decode_fixed(c, b):
    t = c.xtype
    if t == INT: return struct.unpack("<i", b)[0]
    if t == BIGINT: return struct.unpack("<q", b)[0]
    if t == SMALLINT: return struct.unpack("<h", b)[0]
    if t == TINYINT: return b[0]
    if t in (DECIMAL, NUMERIC):
        sign = 1 if b[0] == 1 else -1
        mag = int.from_bytes(b[1:], "little")
        return decimal.Decimal(sign * mag).scaleb(-c.scale)
    if t == MONEY: return decimal.Decimal(struct.unpack("<q", b)[0]).scaleb(-4)
    if t == SMALLMONEY: return decimal.Decimal(struct.unpack("<i", b)[0]).scaleb(-4)
    if t == FLOAT: return struct.unpack("<d", b)[0] if len(b) == 8 else struct.unpack("<f", b)[0]
    if t == REAL: return struct.unpack("<f", b)[0]
    if t == DATETIME:
        ticks = struct.unpack("<I", b[:4])[0]
        days = struct.unpack("<i", b[4:8])[0]
        return EPOCH + datetime.timedelta(days=days, milliseconds=ticks * 10 / 3)
    if t == SMALLDATETIME:
        mins = struct.unpack("<H", b[:2])[0]
        days = struct.unpack("<H", b[2:4])[0]
        return EPOCH + datetime.timedelta(days=days, minutes=mins)
    if t == DATE:
        days = int.from_bytes(b, "little")
        return datetime.date(1, 1, 1) + datetime.timedelta(days=days)
    if t == DATETIME2:
        tb = 3 if c.scale <= 2 else 4 if c.scale <= 4 else 5
        ticks = int.from_bytes(b[:tb], "little")
        days = int.from_bytes(b[tb:tb + 3], "little")
        secs = ticks / (10 ** c.scale)
        return datetime.datetime(1, 1, 1) + datetime.timedelta(days=days, seconds=secs)
    if t == TIME:
        return int.from_bytes(b, "little") / (10 ** c.scale)
    if t == CHAR: return b.decode("latin-1").rstrip(" ")
    if t == NCHAR: return b.decode("utf-16le").rstrip(" ")
    if t == BINARY: return b.hex()
    if t == UNIQUEIDENTIFIER: return str(uuid.UUID(bytes_le=bytes(b)))
    if t == TIMESTAMP: return b.hex()
    return b.hex()


def decode_var(c, b):
    t = c.xtype
    if t in (NVARCHAR, SYSNAME, NTEXT):
        try:
            return b.decode("utf-16le")
        except UnicodeDecodeError:
            return b[: len(b) & ~1].decode("utf-16le", "replace")
    if t in (VARCHAR, TEXT): return b.decode("latin-1")
    if t == XML: return "<xml %d bytes>" % len(b)
    return b.hex()


class RowDecoder:
    """Decode records of one table given its columns in physical order:
    fixed-length columns in leaf offset order, then variable ones in order."""

    def __init__(self, cols):
        self.cols = cols
        self.fixed = [c for c in cols if c.fixed and c.xtype != BIT]
        self.bits = [c for c in cols if c.xtype == BIT]
        self.var = [c for c in cols if not c.fixed]
        # physical offsets for fixed columns: packed in order; bits packed one byte per 8 after the others
        off = 4
        self.fixed_off = {}
        for c in self.fixed:
            self.fixed_off[c.name] = (off, fixed_size(c))
            off += fixed_size(c)
        self.bit_off = {}
        for i, c in enumerate(self.bits):
            self.bit_off[c.name] = (off + i // 8, i % 8)
        self.fixed_end = off + (len(self.bits) + 7) // 8
        self.total = len(cols)

    def decode(self, rec):
        status = rec[0]
        rtype = (status >> 1) & 7
        if rtype not in (0, 1):  # primary or forwarded record only
            return None
        has_null_bitmap = bool(status & 0x10)
        has_var = bool(status & 0x20)
        fixed_end = struct.unpack_from("<H", rec, 2)[0]
        pos = fixed_end
        ncols = struct.unpack_from("<H", rec, pos)[0] if has_null_bitmap else self.total
        pos += 2
        nb = (ncols + 7) // 8
        nullbits = rec[pos:pos + nb] if has_null_bitmap else b""
        pos += nb
        nvar = 0
        var_ends = []
        if has_var:
            nvar = struct.unpack_from("<H", rec, pos)[0]
            pos += 2
            var_ends = [struct.unpack_from("<H", rec, pos + 2 * i)[0] for i in range(nvar)]
            pos += 2 * nvar
        var_start = pos
        out = {}
        # column index (1-based colid order == self.cols order) drives the null bitmap
        for idx, c in enumerate(self.cols):
            is_null = bool(nullbits[idx // 8] & (1 << (idx % 8))) if has_null_bitmap and idx // 8 < len(nullbits) else False
            if c.xtype == BIT:
                if is_null:
                    out[c.name] = None
                    continue
                bo, bi = self.bit_off[c.name]
                out[c.name] = bool(rec[bo] & (1 << bi)) if bo < fixed_end else None
            elif c.fixed:
                if is_null:
                    out[c.name] = None
                    continue
                fo, fs = self.fixed_off[c.name]
                if fo + fs > fixed_end:
                    out[c.name] = None  # column added after the row was written
                    continue
                try:
                    out[c.name] = decode_fixed(c, rec[fo:fo + fs])
                except Exception:
                    out[c.name] = None
            else:
                vi = self.var.index(c)
                if is_null or vi >= nvar:
                    out[c.name] = None
                    continue
                end = var_ends[vi]
                offrow = bool(end & 0x8000)
                end &= 0x7FFF
                start = var_start if vi == 0 else (var_ends[vi - 1] & 0x7FFF)
                chunk = rec[start:end]
                if offrow:
                    out[c.name] = ("<off-row %d bytes>" % len(chunk))
                else:
                    out[c.name] = decode_var(c, chunk)
        return out


# ---------------- system catalog bootstrap ----------------
# Base table layouts (SQL Server 2008+). Physical order = fixed columns in
# declaration order, then variable columns.

SYSALLOCUNITS = [Col("auid", BIGINT), Col("type", TINYINT), Col("ownerid", BIGINT), Col("status", INT), Col("fgid", SMALLINT),
                 Col("pgfirst", BINARY, 6), Col("pgroot", BINARY, 6), Col("pgfirstiam", BINARY, 6),
                 Col("pcused", BIGINT), Col("pcdata", BIGINT), Col("pcreserved", BIGINT), Col("dbfragid", INT)]
SYSROWSETS = [Col("rowsetid", BIGINT), Col("ownertype", TINYINT), Col("idmajor", INT), Col("idminor", INT), Col("numpart", INT),
              Col("status", INT), Col("fgidfs", SMALLINT), Col("rcrows", BIGINT), Col("cmprlevel", TINYINT), Col("fillfact", TINYINT),
              Col("maxnullbit", SMALLINT), Col("maxleaf", INT), Col("maxint", SMALLINT), Col("minleaf", SMALLINT), Col("minint", SMALLINT),
              Col("rsguid", VARBINARY, 16), Col("lockres", VARBINARY, 8), Col("scope_id", INT)]
SYSSCHOBJS = [Col("id", INT), Col("name", SYSNAME), Col("nsid", INT), Col("nsclass", TINYINT), Col("status", INT), Col("type", CHAR, 2),
              Col("pid", INT), Col("pclass", TINYINT), Col("intprop", INT), Col("created", DATETIME), Col("modified", DATETIME), Col("status2", INT)]
SYSCOLPARS = [Col("id", INT), Col("number", SMALLINT), Col("colid", INT), Col("name", SYSNAME), Col("xtype", TINYINT), Col("utype", INT),
              Col("length", SMALLINT), Col("prec", TINYINT), Col("scale", TINYINT), Col("collationid", INT), Col("status", INT),
              Col("maxinrow", SMALLINT), Col("xmlns", INT), Col("dflt", INT), Col("chk", INT), Col("idtval", VARBINARY, 64)]
SYSRSCOLS = [Col("rsid", BIGINT), Col("rscolid", INT), Col("hbcolid", INT), Col("rcmodified", BIGINT), Col("ti", INT), Col("cid", INT),
             Col("ordkey", SMALLINT), Col("maxinrowlen", SMALLINT), Col("status", INT), Col("offset", INT), Col("nullbit", INT),
             Col("bitpos", SMALLINT), Col("colguid", VARBINARY, 16)]

BASE_ALLOC = {"sysallocunits": (7, 0), "sysrowsets": (5, 0), "sysschobjs": (34, 1), "syscolpars": (41, 1), "sysrscols": (3, 0)}


def read_table(bak, allocUnitId, cols):
    dec = RowDecoder(cols)
    out = []
    for p in bak.data_pages(allocUnitId):
        for so, rec in bak.records(p):
            r = dec.decode(rec)
            if r is not None:
                out.append(r)
    return out


def catalog(bak):
    au = lambda idObj, idInd: (idObj << 16) | (idInd << 48)
    allocunits = read_table(bak, au(*BASE_ALLOC["sysallocunits"]), SYSALLOCUNITS)
    rowsets = read_table(bak, au(*BASE_ALLOC["sysrowsets"]), SYSROWSETS)
    objs = read_table(bak, au(*BASE_ALLOC["sysschobjs"]), SYSSCHOBJS)
    colpars = read_table(bak, au(*BASE_ALLOC["syscolpars"]), SYSCOLPARS)
    rscols = read_table(bak, au(*BASE_ALLOC["sysrscols"]), SYSRSCOLS)
    return allocunits, rowsets, objs, colpars, rscols


# ---------------- user tables ----------------

class Table:
    def __init__(self, name, objid, rowsetid, allocUnitId, cols, rcrows):
        self.name, self.objid, self.rowsetid, self.allocUnitId, self.cols, self.rcrows = name, objid, rowsetid, allocUnitId, cols, rcrows


class LayoutDecoder:
    """Decode records using the physical layout from sysrscols: each column
    has a leaf offset (positive = fixed, at that byte; negative = the n-th
    variable column) and a null-bitmap bit."""

    def __init__(self, cols):
        # cols: list of dicts {name, xtype, length, prec, scale, offset, nullbit, bitpos}
        self.cols = cols

    def decode(self, rec):
        status = rec[0]
        rtype = (status >> 1) & 7
        if rtype not in (0, 1):
            return None
        has_null_bitmap = bool(status & 0x10)
        has_var = bool(status & 0x20)
        fixed_end = struct.unpack_from("<H", rec, 2)[0]
        pos = fixed_end
        ncols = 0
        nullbits = b""
        if has_null_bitmap:
            ncols = struct.unpack_from("<H", rec, pos)[0]
            pos += 2
            nb = (ncols + 7) // 8
            nullbits = rec[pos:pos + nb]
            pos += nb
        nvar = 0
        var_ends = []
        if has_var:
            nvar = struct.unpack_from("<H", rec, pos)[0]
            pos += 2
            var_ends = [struct.unpack_from("<H", rec, pos + 2 * i)[0] for i in range(nvar)]
            pos += 2 * nvar
        var_start = pos
        out = {}
        for c in self.cols:
            nbit = c["nullbit"] - 1
            is_null = False
            if has_null_bitmap and 0 <= nbit < ncols:
                is_null = bool(nullbits[nbit // 8] & (1 << (nbit % 8)))
            elif has_null_bitmap and nbit >= ncols:
                is_null = True  # column added after this row was written
            if is_null:
                out[c["name"]] = None
                continue
            col = Col(c["name"], c["xtype"], c["length"], c["prec"], c["scale"])
            off = c["offset"]
            if c["xtype"] == BIT:
                bo = off
                if bo >= fixed_end:
                    out[c["name"]] = None
                else:
                    out[c["name"]] = bool(rec[bo] & (1 << c["bitpos"]))
            elif off > 0:
                size = fixed_size(col)
                if off + size > fixed_end:
                    out[c["name"]] = None
                    continue
                try:
                    out[c["name"]] = decode_fixed(col, rec[off:off + size])
                except Exception:
                    out[c["name"]] = None
            else:
                vi = -off - 1
                if vi >= nvar:
                    out[c["name"]] = None
                    continue
                end = var_ends[vi]
                offrow = bool(end & 0x8000)
                end &= 0x7FFF
                start = var_start if vi == 0 else (var_ends[vi - 1] & 0x7FFF)
                chunk = rec[start:end]
                out[c["name"]] = ("<off-row>", bytes(chunk)) if offrow else decode_var(col, chunk)
        return out


def user_tables(bak):
    allocunits, rowsets, objs, colpars, rscols = catalog(bak)
    names = {o["id"]: o["name"] for o in objs if o["type"] == "U"}
    rs_by_obj = {}
    for r in rowsets:
        if r["idmajor"] in names and r["idminor"] in (0, 1):
            rs_by_obj[r["idmajor"]] = r
    au_by_rowset = {}
    for a in allocunits:
        if a["type"] == 1:  # in-row data
            au_by_rowset.setdefault(a["ownerid"], a)
    cp_by_obj = collections.defaultdict(dict)
    for c in colpars:
        if c["number"] == 0:
            cp_by_obj[c["id"]][c["colid"]] = c
    rsc_by_rs = collections.defaultdict(list)
    for r in rscols:
        rsc_by_rs[r["rsid"]].append(r)
    tables = {}
    for objid, name in names.items():
        rs = rs_by_obj.get(objid)
        if not rs:
            continue
        a = au_by_rowset.get(rs["rowsetid"])
        if not a:
            continue
        cols = []
        for r in rsc_by_rs.get(rs["rowsetid"], []):
            cp = cp_by_obj[objid].get(r["rscolid"])
            if not cp:
                continue
            # offset and nullbit are 16-bit values with flag bits packed above them;
            # a variable-length column has a negative offset (-1 = first var column)
            off = r["offset"] & 0xFFFF
            if off >= 0x8000:
                off -= 0x10000
            nullbit = r["nullbit"] & 0xFFFF
            cols.append({"name": cp["name"], "xtype": cp["xtype"], "length": cp["length"], "prec": cp["prec"], "scale": cp["scale"],
                         "offset": off, "nullbit": nullbit, "bitpos": r["bitpos"], "colid": cp["colid"]})
        cols.sort(key=lambda c: c["colid"])
        tables[name] = Table(name, objid, rs["rowsetid"], a["auid"], cols, rs["rcrows"])
    return tables


def rows(bak, table):
    dec = LayoutDecoder(table.cols)
    for p in bak.data_pages(table.allocUnitId):
        for so, rec in bak.records(p):
            r = dec.decode(rec)
            if r is not None:
                yield r
