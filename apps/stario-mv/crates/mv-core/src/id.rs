//! ID＝種類の頭＋ULID（MV-0001 決定3）。

/// ID の種類（頭の文字）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdKind {
    Project,
    Asset,
    Composition,
    Layer,
    Effect,
    Mask,
    Marker,
}

impl IdKind {
    /// 頭の文字（`_` の前）。
    pub fn prefix(self) -> &'static str {
        match self {
            IdKind::Project => "prj",
            IdKind::Asset => "ast",
            IdKind::Composition => "cmp",
            IdKind::Layer => "lyr",
            IdKind::Effect => "fx",
            IdKind::Mask => "msk",
            IdKind::Marker => "mkr",
        }
    }
}

/// 新しい ID を発行する（重複しない・時刻順に並ぶ）。
pub fn new_id(kind: IdKind) -> String {
    format!("{}_{}", kind.prefix(), ulid::Ulid::new())
}

/// その種類の ID の形になっているか（Crockford Base32 の 26 文字＝I・L・O・U を使わない）。
pub fn is_valid_id(kind: IdKind, id: &str) -> bool {
    let Some(rest) = id
        .strip_prefix(kind.prefix())
        .and_then(|r| r.strip_prefix('_'))
    else {
        return false;
    };
    rest.len() == 26
        && rest.bytes().all(|b| {
            b.is_ascii_digit()
                || (b.is_ascii_uppercase() && !matches!(b, b'I' | b'L' | b'O' | b'U'))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 発行した_id_は形に合い_重複しない() {
        let all = [
            IdKind::Project,
            IdKind::Asset,
            IdKind::Composition,
            IdKind::Layer,
            IdKind::Effect,
            IdKind::Mask,
            IdKind::Marker,
        ];
        for kind in all {
            let a = new_id(kind);
            let b = new_id(kind);
            assert!(is_valid_id(kind, &a), "{a}");
            assert_ne!(a, b);
        }
    }

    #[test]
    fn 頭の違う_id_や使えない文字は通さない() {
        let ok = "lyr_01JDQ0000000000000000000Y1";
        assert!(is_valid_id(IdKind::Layer, ok));
        assert!(!is_valid_id(IdKind::Composition, ok));
        assert!(!is_valid_id(
            IdKind::Layer,
            "lyr_01JDQ0000000000000000000L1"
        ));
        assert!(!is_valid_id(IdKind::Layer, "lyr_01JDQ000000000000000000Y1"));
        assert!(!is_valid_id(IdKind::Layer, "lyr01JDQ0000000000000000000Y1"));
    }
}
