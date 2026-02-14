#!/usr/bin/env raku
# Test file for multi-line formatting rules.
# Must compile with `raku -c`.

# ==========================================================================
# POSITIVE 1 — Uncuddled else (should cuddle)
# ==========================================================================

sub test-cuddle-else {
    my $x = 5;
    if $x > 0 {
        say "positive";
    }
    else {
        say "not positive";
    }
}

# ==========================================================================
# POSITIVE 2 — Uncuddled elsif chain (should cuddle both)
# ==========================================================================

sub test-cuddle-elsif {
    my $x = 5;
    if $x > 10 {
        say "big";
    }
    elsif $x > 0 {
        say "small";
    }
    else {
        say "negative";
    }
}

# ==========================================================================
# POSITIVE 3 — Opening brace on next line — class
# ==========================================================================

class ClassBraceDown
{
    has $.attribute;
}

# ==========================================================================
# POSITIVE 4 — Opening brace on next line — method
# ==========================================================================

class MethodBraceDown {
    method compute()
    {
        return 42;
    }
}

# ==========================================================================
# POSITIVE 5 — Opening brace on next line — sub
# ==========================================================================

sub sub-brace-down()
{
    say "hello";
}

# ==========================================================================
# POSITIVE 6 — No space before brace
# ==========================================================================

class FooNoSpace{
    has $.x;
}

sub bar-no-space{
    return 1;
}

# ==========================================================================
# POSITIVE 7 — Combined issues (missing space + brace on next line + uncuddled)
# ==========================================================================

class BadClassCombined{
    has $.value;
    method test()
    {
        my $x = 1;
        if $x > 0 {
            say "yes";
        }
        else{
            say "no";
        }
    }
}

# ==========================================================================
# NEGATIVE 1 — Multi-line signature (should NOT move brace up)
# ==========================================================================

sub complex-sig(
    $param1,
    $param2
) {
    say "body";
}

# ==========================================================================
# NEGATIVE 2 — Signature with where constraint (should NOT move brace)
# ==========================================================================

sub guarded-sig(
    Int $param1 where { $_ > 0 },
    Int $param2
) {
    say "body";
}

# ==========================================================================
# NEGATIVE 3 — Hash literal on new line (should NOT move brace)
# ==========================================================================

sub test-hash-newline {
    my %h = %(
        a => 1,
        b => 2,
    );
}

# ==========================================================================
# NEGATIVE 4 — Strings / comments with brace patterns (should NOT cuddle)
# ==========================================================================

sub test-string-brace-patterns {
    my $msg = '} else {';
    # } else { should stay in comment
    say $msg;
}

# ==========================================================================
# NEGATIVE 5 — Regex with braces (should NOT add space before brace)
# ==========================================================================

sub test-regex-braces {
    my $re = rx{ foo <[ a..z ]> };
    "hello" ~~ / \w+ /;
}

# ==========================================================================
# NEGATIVE 6 — Already cuddled (should NOT change)
# ==========================================================================

sub test-already-cuddled {
    my $x = 1;
    if $x > 0 {
        say "yes";
    } else {
        say "no";
    }
}

# ==========================================================================
# NEGATIVE 7 — Brace already on same line (should NOT change)
# ==========================================================================

class AlreadyCorrectClass {
    has $.val;
    method get() { $.val }
}

sub already-correct-sub() {
    return 1;
}
