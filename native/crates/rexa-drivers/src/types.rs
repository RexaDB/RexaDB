//! Typed column metadata for result sets — the original's `fields`
//! (`{ name, dataTypeID, dataTypeName }`) plus a coarse category the grid
//! uses to align numbers, pick editors (checkbox, date picker, JSON sheet)
//! and decide whether a literal needs quotes.

/// Coarse type family, engine-independent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum TypeCategory {
    Integer,
    /// Floating point / numeric / decimal / money.
    Decimal,
    Boolean,
    Text,
    Uuid,
    Json,
    Date,
    Time,
    Timestamp,
    Interval,
    Binary,
    Array,
    Enum,
    Network,
    Geometry,
    #[default]
    Other,
}

impl TypeCategory {
    /// Classify a server type name (`int4`, `character varying(255)`,
    /// `Nullable(UInt64)`, `NVARCHAR`, `TIMESTAMP WITH TIME ZONE`, `I64`, …).
    pub fn classify(type_name: &str) -> TypeCategory {
        let mut t = type_name.trim().to_ascii_lowercase();
        // ClickHouse wrappers.
        while let Some(rest) = t.strip_prefix("nullable(").or_else(|| t.strip_prefix("lowcardinality(")) {
            t = rest.strip_suffix(')').unwrap_or(rest).to_string();
        }
        // SpacetimeDB Option<T>.
        if let Some(rest) = t.strip_prefix("option<") {
            t = rest.trim_end_matches('>').to_string();
        }
        if t.ends_with("[]") || t.starts_with('_') || t == "array" || t.starts_with("array") || t.starts_with("list(") {
            return TypeCategory::Array;
        }
        let base = t.split(['(', ' ']).next().unwrap_or("").trim_end_matches(',');
        if t.starts_with("timestamp") || t.starts_with("datetime") || base == "smalldatetime" || base == "datetimeoffset" {
            return TypeCategory::Timestamp;
        }
        if t.starts_with("time") && base != "timeduration" {
            return TypeCategory::Time;
        }
        if t.starts_with("double precision") {
            return TypeCategory::Decimal;
        }
        if t.starts_with("character varying") || t.starts_with("character") {
            return TypeCategory::Text;
        }
        if t.starts_with("bit varying") {
            return TypeCategory::Other;
        }
        match base {
            "int" | "int2" | "int4" | "int8" | "integer" | "smallint" | "bigint" | "tinyint" | "mediumint" | "serial"
            | "bigserial" | "smallserial" | "serial4" | "serial8" | "long" | "longlong" | "short" | "tiny" | "int24"
            | "year" | "hugeint" | "uhugeint" | "ubigint" | "uinteger" | "usmallint" | "utinyint" | "oid" | "xid" | "number"
            | "u8" | "u16" | "u32" | "u64" | "u128" | "u256" | "i8" | "i16" | "i32" | "i64" | "i128" | "i256"
            | "uint8" | "uint16" | "uint32" | "uint64" | "uint128" | "uint256" | "int16" | "int32" | "int64" | "int128"
            | "int256" | "integer_" => {
                if base == "number" && t.contains(',') && !t.ends_with(",0)") {
                    TypeCategory::Decimal
                } else {
                    TypeCategory::Integer
                }
            }
            "numeric" | "decimal" | "newdecimal" | "real" | "float" | "float4" | "float8" | "double" | "money"
            | "smallmoney" | "f32" | "f64" | "float32" | "float64" | "binary_float" | "binary_double" | "decimal32"
            | "decimal64" | "decimal128" | "decimal256" => TypeCategory::Decimal,
            "bool" | "boolean" | "bit" => TypeCategory::Boolean,
            "uuid" | "uniqueidentifier" => TypeCategory::Uuid,
            "json" | "jsonb" | "object" | "document" | "variant" | "map" | "struct" | "product" | "sum" => TypeCategory::Json,
            "date" | "date32" | "newdate" => TypeCategory::Date,
            "interval" | "timeduration" => TypeCategory::Interval,
            "bytea" | "blob" | "tinyblob" | "mediumblob" | "longblob" | "binary" | "varbinary" | "image" | "raw"
            | "long raw" | "bytes" | "tiny_blob" | "medium_blob" | "long_blob" => TypeCategory::Binary,
            "enum" | "enum8" | "enum16" | "set" => TypeCategory::Enum,
            "inet" | "cidr" | "macaddr" | "macaddr8" | "ipv4" | "ipv6" => TypeCategory::Network,
            "geometry" | "geography" | "point" | "line" | "lseg" | "box" | "path" | "polygon" | "circle" => {
                TypeCategory::Geometry
            }
            "text" | "varchar" | "char" | "nchar" | "nvarchar" | "ntext" | "string" | "fixedstring" | "bpchar"
            | "name" | "citext" | "tinytext" | "mediumtext" | "longtext" | "var_string" | "clob" | "nclob"
            | "varchar2" | "nvarchar2" | "xml" | "identity" | "connectionid" | "objectid" | "citext_" => TypeCategory::Text,
            _ => TypeCategory::Other,
        }
    }

    pub fn is_numeric(self) -> bool {
        matches!(self, TypeCategory::Integer | TypeCategory::Decimal)
    }

    /// Values are right-aligned in the grid.
    pub fn align_right(self) -> bool {
        self.is_numeric()
    }
}

/// Type of one result column.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ColumnMeta {
    pub name: String,
    /// Server type name (`dataTypeName`): `int4`, `varchar`, `long`,
    /// `Nullable(String)`, … or `unknown`.
    pub type_name: String,
    /// Engine type id (`dataTypeID`: Postgres OID, MySQL column type), 0 when unknown.
    pub type_id: u32,
    pub category: TypeCategory,
}

impl ColumnMeta {
    pub fn new(name: impl Into<String>, type_name: impl Into<String>) -> Self {
        let type_name = type_name.into();
        ColumnMeta { name: name.into(), category: TypeCategory::classify(&type_name), type_name, type_id: 0 }
    }

    pub fn with_id(mut self, id: u32) -> Self {
        self.type_id = id;
        self
    }

    pub fn unknown(name: impl Into<String>) -> Self {
        ColumnMeta { name: name.into(), type_name: "unknown".into(), type_id: 0, category: TypeCategory::Other }
    }
}

#[cfg(test)]
mod tests {
    use super::TypeCategory as T;

    #[test]
    fn classifies_across_engines() {
        assert_eq!(T::classify("int4"), T::Integer);
        assert_eq!(T::classify("character varying(255)"), T::Text);
        assert_eq!(T::classify("timestamp with time zone"), T::Timestamp);
        assert_eq!(T::classify("Nullable(UInt64)"), T::Integer);
        assert_eq!(T::classify("LowCardinality(Nullable(String))"), T::Text);
        assert_eq!(T::classify("double precision"), T::Decimal);
        assert_eq!(T::classify("_int4"), T::Array);
        assert_eq!(T::classify("text[]"), T::Array);
        assert_eq!(T::classify("NVARCHAR"), T::Text);
        assert_eq!(T::classify("jsonb"), T::Json);
        assert_eq!(T::classify("bool"), T::Boolean);
        assert_eq!(T::classify("NUMBER(10,2)"), T::Decimal);
        assert_eq!(T::classify("NUMBER(10,0)"), T::Integer);
        assert_eq!(T::classify("Option<I64>"), T::Integer);
        assert_eq!(T::classify("time without time zone"), T::Time);
        assert_eq!(T::classify("DECIMAL(18,2)"), T::Decimal);
        assert_eq!(T::classify("whatever"), T::Other);
    }
}
