//! The wizard's stage order and the moves a stage hands back to the driver.

/// The wizard stages, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Stage {
    Scope,
    Services,
    Host,
    Ports,
    Tls,
    Review,
}

impl Stage {
    pub(super) const ALL: [Stage; 6] = [
        Stage::Scope,
        Stage::Services,
        Stage::Host,
        Stage::Ports,
        Stage::Tls,
        Stage::Review,
    ];
    pub(super) fn label(&self) -> &'static str {
        match self {
            Stage::Scope => "Scope",
            Stage::Services => "Services",
            Stage::Host => "Address",
            Stage::Ports => "Ports",
            Stage::Tls => "Access",
            Stage::Review => "Review",
        }
    }
}

/// How a stage wants the driver to move.
pub(super) enum Move {
    Next,
    Back,
    Abort,
    /// Jump to a specific stage index (the Review "change an answer" path).
    Jump(usize),
    /// The wizard is finished; deploy with the collected config.
    Finish,
}

pub(super) fn idx_of(stage: Stage) -> usize {
    Stage::ALL.iter().position(|s| *s == stage).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_ordering_and_labels() {
        assert_eq!(Stage::ALL.len(), 6);
        assert_eq!(idx_of(Stage::Review), 5);
        assert_eq!(Stage::Scope.label(), "Scope");
    }
}
