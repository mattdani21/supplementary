/**
 * The reference source document.
 *
 * Written for this repository, so it is copyright-safe and can be version-controlled. It is
 * deliberately structured with headings and numbered sections, because chunk locators are part
 * of what the ingestion stage must preserve.
 */

export const SET_THEORY_SOURCE_ID = 'src_set_theory_primer';

export const SET_THEORY_SOURCE = `# A Short Primer on Sets and Relations

## 1. Sets and membership

A set is an unordered collection of distinct objects, called its elements. We write a in A to
mean that a is an element of A, and a not in A otherwise. Two sets are equal exactly when they
have the same elements; order and repetition carry no information.

The empty set, written {}, has no elements. It is a subset of every set.

## 2. Subsets and set equality

A is a subset of B, written A subset-of B, when every element of A is also an element of B.

Set equality is usually proved by double inclusion: to show A = B, show A subset-of B and then
show B subset-of A. Each direction is proved by taking an arbitrary element of the left-hand set
and deriving membership of the right-hand set. The word "arbitrary" is doing real work: the
argument must not depend on any property of the chosen element beyond its membership.

## 3. Operations on sets

The union A union B contains every element that lies in A, in B, or in both. The intersection
A intersect B contains exactly the elements lying in both. The difference A \\ B contains the
elements of A that are not elements of B.

These operations satisfy the distributive laws:

  A intersect (B union C) = (A intersect B) union (A intersect C)
  A union (B intersect C) = (A union B) intersect (A union C)

Both are proved by double inclusion.

## 4. Ordered pairs and the Cartesian product

An ordered pair (a, b) is determined by its first and second coordinate: (a, b) = (c, d) exactly
when a = c and b = d. Unlike a set, an ordered pair is sensitive to order.

The Cartesian product A x B is the set of all ordered pairs (a, b) with a in A and b in B.

## 5. Relations

A relation R from A to B is a subset of A x B. When A = B we call R a relation on A. We write
a R b as a shorthand for (a, b) in R.

A relation R on a set A may have any of these properties:

  reflexive:  for every a in A, a R a
  symmetric:  whenever a R b, also b R a
  transitive: whenever a R b and b R c, also a R c
  antisymmetric: whenever a R b and b R a, a = b

Note that reflexivity is a claim about every element of A, so a relation can fail to be reflexive
because of a single element it omits. Symmetry and transitivity, by contrast, are conditional:
they say nothing about pairs that are not related, which is why the empty relation on a non-empty
set is symmetric and transitive but not reflexive.

## 6. Equivalence relations and classes

A relation that is reflexive, symmetric and transitive is an equivalence relation.

Given an equivalence relation R on A and an element a in A, the equivalence class of a is

  [a] = { x in A : x R a }

The central theorem is that the equivalence classes of R partition A: every element lies in
exactly one class, and two classes are either identical or disjoint. The proof that two classes
are either equal or disjoint uses all three properties: symmetry and transitivity to show that a
shared element forces equality, and reflexivity to show that no element is left out.

## 7. Worked example

Let A = {1, 2, 3, 4, 5, 6} and define a R b when a and b leave the same remainder on division
by 3. R is reflexive because every number has the same remainder as itself; symmetric because
equality of remainders is symmetric; and transitive for the same reason. The classes are

  [1] = {1, 4}, [2] = {2, 5}, [3] = {3, 6}

which partition A into three disjoint non-empty pieces.
`;

/** Section boundaries the extractor is expected to find, used to assert locator fidelity. */
export const SET_THEORY_SECTIONS = [
  '1. Sets and membership',
  '2. Subsets and set equality',
  '3. Operations on sets',
  '4. Ordered pairs and the Cartesian product',
  '5. Relations',
  '6. Equivalence relations and classes',
  '7. Worked example',
] as const;
