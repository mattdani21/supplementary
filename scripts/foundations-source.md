# Foundational mathematics for machine learning

A compact primer covering the mathematics every ML course assumes. Work through it in
order; each section is a prerequisite for the next.

## 1. Sets and set-builder notation

A **set** is an unordered collection of distinct objects, written with braces:
`A = {1, 2, 3}`. Membership is written `2 ∈ A`; non-membership `4 ∉ A`. The empty set
is `∅ = {}`.

**Set-builder notation** describes a set by a rule instead of a list:
`A = {x ∈ ℤ | x > 0}` reads "the set of integers x such that x is greater than 0".
The vertical bar is read "such that". This notation appears constantly in definitions
of domains, spans, and solution sets.

**Basic operations:**

- Union: `A ∪ B = {x | x ∈ A or x ∈ B}` — everything in either set.
- Intersection: `A ∩ B = {x | x ∈ A and x ∈ B}` — everything in both.
- Difference: `A \ B = {x | x ∈ A and x ∉ B}` — in A but not B.
- Subset: `A ⊆ B` means every element of A is also in B.
- **Set equality** is proved by double inclusion: show `A ⊆ B` and `B ⊆ A`.

**Example.** Let `A = {1, 2, 3}` and `B = {2, 3, 4}`. Then `A ∪ B = {1, 2, 3, 4}`,
`A ∩ B = {2, 3}`, and `A \ B = {1}`.

## 2. Ordered pairs, Cartesian products, and relations

An **ordered pair** `(a, b)` differs from a set: order matters, so `(a, b) ≠ (b, a)`
unless `a = b`. The **Cartesian product** `A × B` is the set of all ordered pairs with
first element from A and second from B:

    A × B = {(a, b) | a ∈ A, b ∈ B}

If `A` has m elements and `B` has n elements, then `A × B` has m·n elements.

A **relation** on a set A is a subset of `A × A` — a rule pairing elements. A relation
`R` is:

- **reflexive** if `(a, a) ∈ R` for every `a ∈ A`;
- **symmetric** if `(a, b) ∈ R` implies `(b, a) ∈ R`;
- **transitive** if `(a, b) ∈ R` and `(b, c) ∈ R` imply `(a, c) ∈ R`.

A relation that is reflexive, symmetric, and transitive is an **equivalence relation**;
it partitions the set into **equivalence classes** of mutually related elements.

## 3. Functions and notation

A **function** `f: A → B` assigns to every element of A exactly one element of B.
A is the **domain**, B is the **codomain**. We write `y = f(x)`.

- **Injective** (one-to-one): different inputs give different outputs.
- **Surjective** (onto): every element of B is hit by some input.
- **Bijective**: both injective and surjective — a perfect matching, which guarantees
  an inverse function.

**Composition** `(g ∘ f)(x) = g(f(x))` applies f first, then g. Composition is how
neural networks chain layers: `output = layer_2(layer_1(input))`.

**Example.** `f(x) = 2x + 1` on the reals is bijective with inverse `f⁻¹(y) = (y − 1)/2`.

## 4. Real numbers, intervals, and absolute value

The real line is the number system used throughout ML. **Intervals** are subsets of ℝ:

- `[a, b]` — closed: includes a and b.
- `(a, b)` — open: excludes a and b.

The **absolute value** `|x|` is the distance from 0: `|x| = x` when `x ≥ 0`, else `−x`.
It measures error: if the true value is `t` and a model predicts `p`, the error is
`|t − p|`.

**Inequalities** flip direction when multiplied by a negative number:
`−2x < 4` becomes `x > −2`.

## 5. Algebra: solving, exponents, and logarithms

**Linear equations** are solved by isolating the variable:
`3x + 5 = 14 → 3x = 9 → x = 3`.

**Laws of exponents** (a, b > 0, m, n real):

- `a^m · a^n = a^(m+n)`
- `(a^m)^n = a^(m·n)`
- `a^(−n) = 1 / a^n`
- `a^0 = 1`

**Logarithms** are the inverse of exponentiation: `log_b(y) = x` means `b^x = y`.
Two laws matter constantly in ML:

- `log(x·y) = log(x) + log(y)` — products become sums.
- `log(x^p) = p·log(x)` — powers become products.

The natural logarithm `ln` uses base `e ≈ 2.71828`. Cross-entropy and KL divergence
are built from logarithms of probabilities.

**Example.** `ln(e^3) = 3`, and `ln(8) = 3·ln(2)`.

## 6. Summation and the Σ notation

The **summation symbol** `Σ` compresses repeated addition:

    Σ_{i=1}^{n} x_i = x_1 + x_2 + ... + x_n

The index `i` runs from 1 to n. Sums are **linear**:

- `Σ (a_i + b_i) = Σ a_i + Σ b_i`
- `Σ c·a_i = c·Σ a_i`

The **mean** of n numbers is `(1/n)·Σ x_i`. Vector dot products, matrix products, and
attention scores are all sums written with this notation.

## 7. Coordinate geometry and straight lines

A point `(x, y)` lives in the plane. The **distance** between `(x₁, y₁)` and `(x₂, y₂)`
is `√((x₂ − x₁)² + (y₂ − y₁)²)` — Pythagoras. This generalises to the **Euclidean
norm** of a vector in any dimension.

A straight line has **slope** `m = Δy/Δx = (y₂ − y₁)/(x₂ − x₁)` and the form
`y = mx + c`. Linear regression fits a line to data by choosing m and c to minimise
the sum of squared vertical errors.

**Example.** The line through `(0, 1)` and `(2, 5)` has slope `(5 − 1)/(2 − 0) = 2`,
so `y = 2x + 1`.

## 8. Why this matters for machine learning

Every ML course assumes these tools without re-teaching them:

- **Sets and relations** — the vocabulary of domains, equivalence, and partitioning.
- **Functions** — every model is a function; composing functions is a network.
- **Logarithms and sums** — loss functions, probabilities, and the Σ in attention.
- **Coordinate geometry** — points, distance, and the geometric view of vectors.

Before touching linear algebra, verify you can: write a set in set-builder notation,
prove set equality by double inclusion, check whether a relation is an equivalence
relation, solve `3x + 5 = 14`, simplify `log(a·b)`, and expand `Σ_{i=1}^{3} (2i + 1)`.
These are the moves the algebra of vectors and matrices repeats.
