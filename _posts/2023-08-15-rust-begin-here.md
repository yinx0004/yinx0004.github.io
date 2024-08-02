---
title: 'Rust Begin Here'
date: 2023-08-15
permalink: /posts/2023/08/rust-begin-here/
tags:
  - Rust
comments: true
featured: true
imagefeature: cover10.jpg
---
# Local Rust Installation
## Install
```
$ curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
More details refer to the [guide](https://doc.rust-lang.org/book/ch01-01-installation.html).

## Components installed
- cargo: the Rust’s build system and package manager.
- rustfmt: a tool for formatting Rust code according to style guidelines.

# Hello World!
## New
Create a new project with Cargo
```
$ cargo new hello_world
     Created binary (application) `hello_world` package
```

A quick glance
```
$ cat hello_world/src/main.rs
fn main() {
    println!("Hello, world!");
}
```

## Build
```
$ cd hello_world
$ cargo build
```
>binary hello_world was created under target/debug

## Run
```
$ target/debug/hello_world
Hello, world!
```

or

```
$ cargo run
    Finished dev [unoptimized + debuginfo] target(s) in 0.03s
     Running `target/debug/hello_world`
Hello, world!
```

## Project Directory
```
$ tree
.
├── Cargo.lock
├── Cargo.toml
├── src
│   └── main.rs
└── target
    ├── CACHEDIR.TAG
    └── debug
        ├── build
        ├── deps
        │   ├── hello_world-a65d4c6029deb9db
        │   ├── hello_world-a65d4c6029deb9db.2m06qpscokrdldr2.rcgu.o
        │   ├── hello_world-a65d4c6029deb9db.337tnzf71uan4bv8.rcgu.o
        │   ├── hello_world-a65d4c6029deb9db.3lakkzjgkq4s2ufz.rcgu.o
        │   ├── hello_world-a65d4c6029deb9db.3nyq6f5mboo59omw.rcgu.o
        │   ├── hello_world-a65d4c6029deb9db.3txvt6tt1wrkqp6g.rcgu.o
        │   ├── hello_world-a65d4c6029deb9db.d
        │   └── hello_world-a65d4c6029deb9db.okmjk6ajfymokvw.rcgu.o
        ├── examples
        ├── hello_world
        ├── hello_world.d
        └── incremental
            └── hello_world-27bxg3u8cn054
                ├── s-gq9ubsyjer-cu1tnq-8pp2iqcnvjen9b1yyqrks0gg0
                │   ├── 2m06qpscokrdldr2.o
                │   ├── 337tnzf71uan4bv8.o
                │   ├── 3lakkzjgkq4s2ufz.o
                │   ├── 3nyq6f5mboo59omw.o
                │   ├── 3txvt6tt1wrkqp6g.o
                │   ├── dep-graph.bin
                │   ├── okmjk6ajfymokvw.o
                │   ├── query-cache.bin
                │   └── work-products.bin
                └── s-gq9ubsyjer-cu1tnq.lock

10 directories, 24 files
```


# IDE Recommendation
## VSCode
Some plugins to recommend:
- Rust Syntax: provides a TextMate grammar for Rust.
- rust-analyzer: an implementation of Language Server Protocol for the Rust programming language. It provides features like completion and goto definition for many code editors, including VS Code, Emacs and Vim.
- crates: helps Rust developers managing dependencies with Cargo.toml.
- Even Better Toml: a TOML language support extension.
- Rust Test Lens: adds a code lens to quickly run or debug a single test for your Rust code.

## RustRover
From JetBrains, currently RustRover is free to use during the public preview, [download](https://www.jetbrains.com/rust/nextversion/).
