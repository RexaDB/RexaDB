//! Tailwind typography. GPUI's `text_sm()` etc. set only the size; Tailwind
//! pairs each size with a line height, which drives every row height in the
//! old UI. Always use these.

use gpui::{px, Styled};

pub trait Tw: Styled + Sized {
    /// text-[10px] (line-height inherits; most uses add leading-none).
    fn tw_text_10(self) -> Self {
        self.text_size(px(10.)).line_height(px(15.))
    }
    /// text-[11px]
    fn tw_text_11(self) -> Self {
        self.text_size(px(11.)).line_height(px(16.5))
    }
    /// text-xs: 12px / 16px
    fn tw_text_xs(self) -> Self {
        self.text_size(px(12.)).line_height(px(16.))
    }
    /// text-[13px] (buttons): 13px / 1.5
    fn tw_text_13(self) -> Self {
        self.text_size(px(13.)).line_height(px(19.5))
    }
    /// text-sm: 14px / 20px
    fn tw_text_sm(self) -> Self {
        self.text_size(px(14.)).line_height(px(20.))
    }
    /// text-base: 16px / 24px
    fn tw_text_base(self) -> Self {
        self.text_size(px(16.)).line_height(px(24.))
    }
    /// text-lg: 18px / 28px
    fn tw_text_lg(self) -> Self {
        self.text_size(px(18.)).line_height(px(28.))
    }
    /// text-xl: 20px / 28px
    fn tw_text_xl(self) -> Self {
        self.text_size(px(20.)).line_height(px(28.))
    }
    /// text-2xl: 24px / 32px
    fn tw_text_2xl(self) -> Self {
        self.text_size(px(24.)).line_height(px(32.))
    }
    /// leading-none
    fn tw_leading_none(self) -> Self {
        self.line_height(gpui::relative(1.))
    }
    /// rounded-sm / md / lg / xl from --radius (10px): 6 / 8 / 10 / 14
    fn tw_rounded_sm(self) -> Self {
        self.rounded(px(6.))
    }
    fn tw_rounded_md(self) -> Self {
        self.rounded(px(8.))
    }
    fn tw_rounded_lg(self) -> Self {
        self.rounded(px(10.))
    }
    fn tw_rounded_xl(self) -> Self {
        self.rounded(px(14.))
    }
}

impl<T: Styled> Tw for T {}
