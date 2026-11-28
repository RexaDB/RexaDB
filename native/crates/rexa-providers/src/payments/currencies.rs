//! Port of `lib/supabase-paykit/currencies.ts`.

#[derive(Clone, Copy, Debug)]
pub struct PaykitCurrency {
    pub code: &'static str,
    pub name: &'static str,
    pub symbol: &'static str,
}

/// ISO currencies for the product sheet picker.
pub const PAYKIT_CURRENCIES: &[PaykitCurrency] = &[
    PaykitCurrency { code: "usd", name: "US Dollar", symbol: "$" },
    PaykitCurrency { code: "eur", name: "Euro", symbol: "€" },
    PaykitCurrency { code: "gbp", name: "British Pound", symbol: "£" },
    PaykitCurrency { code: "jpy", name: "Japanese Yen", symbol: "¥" },
    PaykitCurrency { code: "aed", name: "United Arab Emirates Dirham", symbol: "د.إ" },
    PaykitCurrency { code: "aud", name: "Australian Dollar", symbol: "A$" },
    PaykitCurrency { code: "brl", name: "Brazilian Real", symbol: "R$" },
    PaykitCurrency { code: "cad", name: "Canadian Dollar", symbol: "C$" },
    PaykitCurrency { code: "chf", name: "Swiss Franc", symbol: "CHF" },
    PaykitCurrency { code: "cny", name: "Chinese Yuan", symbol: "¥" },
    PaykitCurrency { code: "dkk", name: "Danish Krone", symbol: "kr" },
    PaykitCurrency { code: "egp", name: "Egyptian Pound", symbol: "E£" },
    PaykitCurrency { code: "hkd", name: "Hong Kong Dollar", symbol: "HK$" },
    PaykitCurrency { code: "huf", name: "Hungarian Forint", symbol: "Ft" },
    PaykitCurrency { code: "idr", name: "Indonesian Rupiah", symbol: "Rp" },
    PaykitCurrency { code: "ils", name: "Israeli Shekel", symbol: "₪" },
    PaykitCurrency { code: "inr", name: "Indian Rupee", symbol: "₹" },
    PaykitCurrency { code: "kes", name: "Kenyan Shilling", symbol: "KSh" },
    PaykitCurrency { code: "krw", name: "South Korean Won", symbol: "₩" },
    PaykitCurrency { code: "mxn", name: "Mexican Peso", symbol: "M$" },
    PaykitCurrency { code: "myr", name: "Malaysian Ringgit", symbol: "RM" },
    PaykitCurrency { code: "ngn", name: "Nigerian Naira", symbol: "₦" },
    PaykitCurrency { code: "nok", name: "Norwegian Krone", symbol: "kr" },
    PaykitCurrency { code: "nzd", name: "New Zealand Dollar", symbol: "NZ$" },
    PaykitCurrency { code: "php", name: "Philippine Peso", symbol: "₱" },
    PaykitCurrency { code: "pkr", name: "Pakistani Rupee", symbol: "₨" },
    PaykitCurrency { code: "pln", name: "Polish Zloty", symbol: "zł" },
    PaykitCurrency { code: "qar", name: "Qatari Riyal", symbol: "QR" },
    PaykitCurrency { code: "ron", name: "Romanian Leu", symbol: "lei" },
    PaykitCurrency { code: "sar", name: "Saudi Riyal", symbol: "﷼" },
    PaykitCurrency { code: "sek", name: "Swedish Krona", symbol: "kr" },
    PaykitCurrency { code: "sgd", name: "Singapore Dollar", symbol: "S$" },
    PaykitCurrency { code: "thb", name: "Thai Baht", symbol: "฿" },
    PaykitCurrency { code: "try", name: "Turkish Lira", symbol: "₺" },
    PaykitCurrency { code: "twd", name: "Taiwan Dollar", symbol: "NT$" },
    PaykitCurrency { code: "uah", name: "Ukrainian Hryvnia", symbol: "₴" },
    PaykitCurrency { code: "vnd", name: "Vietnamese Dong", symbol: "₫" },
    PaykitCurrency { code: "zar", name: "South African Rand", symbol: "R" },
];

/// `currencySymbol`.
pub fn currency_symbol(code: &str) -> &'static str {
    let needle = if code.is_empty() { "usd" } else { code };
    PAYKIT_CURRENCIES
        .iter()
        .find(|c| c.code.eq_ignore_ascii_case(needle))
        .map(|c| c.symbol)
        .unwrap_or("$")
}
