#!/usr/bin/env raku

# Test file for Find All References and Rename Symbol features

## Test 1: Local Variables
sub test-local-variables {
    my $counter = 0;
    $counter++;
    say $counter;
    return ${counter};
}

## Test 2: Class with Methods
class Calculator {
    has $.value = 0;

    method add($amount) {
        $.value += $amount;
        return $.value;
    }

    method subtract($amount) {
        $.value -= $amount;
        return $.value;
    }

    method reset {
        $.value = 0;
    }
}

## Test 3: Using the class
sub main {
    my $calc = Calculator.new(value => 10);
    my $result = $calc.add(5);
    say "Result: $result";

    $calc.subtract(3);
    say "New value: {$calc.value}";

    $calc.reset;
}

## Test 4: Variables with different sigils
sub test-sigils {
    my $scalar = 42;
    my @array = (1, 2, 3);
    my %hash = (a => 1, b => 2);

    say $scalar;
    say @array;
    say %hash;

    for @array -> $item {
        say "Item: $item times $scalar";
    }
}

## Test 5: Multi-dispatch subs
multi sub greet(Str $name) {
    say "Hello, $name!";
}

multi sub greet(Int $count) {
    say "Hello " x $count;
}

multi sub greet(Str $name, Int $count) {
    say "Hello, $name! " x $count;
}

## Test 6: Grammar tokens
grammar SimpleParser {
    token TOP { <statement>+ }
    token statement { <word> <.ws> }
    token word { \w+ }
}

## Test 7: Role composition
role Printable {
    method print {
        say self.gist;
    }
}

class Document does Printable {
    has $.title;
    has $.content;
}

## Test 8: Object attributes
class Person {
    has $.name;
    has $!age;

    method birthday {
        $!age++;
    }

    method get-age {
        return $!age;
    }

    method describe {
        say "Name: $.name, Age: {$!age}";
    }
}

# Run main if called directly
main() if $*PROGRAM-NAME eq $?FILE;
