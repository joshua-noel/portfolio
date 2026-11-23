---
course: how-language-models-work
order: 1
slug: attention-and-the-transformer
title: Attention and the transformer
promise: How a transformer lets every token read from the others, and why that gets more expensive the longer the text is.
visibility: public
video: true
minutes: { tip: 2, waterline: 11, deep: 8, abyss: 6 }
objectives:
  - Compute one attention step by hand, from scores to softmax weights to the weighted sum of values.
  - Explain what queries, keys and values are, and why the scores are divided by $\sqrt{d_k}$.
  - Explain how multi-head attention and position information fit into the model.
  - Draw one transformer block and say what attention, the MLP, the residual connection and normalization each do.
  - Explain causal masking, and why attention cost grows with the square of the sequence length.
prerequisites: []
sources:
  - { id: Transformer, title: "Attention Is All You Need (Vaswani et al., 2017)", url: "https://arxiv.org/abs/1706.03762", used_for: "attention, multi-head attention, positions, the block, masking, Table 1" }
  - { id: Bahdanau, title: "Neural Machine Translation by Jointly Learning to Align and Translate (2014)", url: "https://arxiv.org/abs/1409.0473", used_for: "attention in translation, additive scoring" }
  - { id: Luong, title: "Effective Approaches to Attention-based Neural Machine Translation (2015)", url: "https://arxiv.org/abs/1508.04025", used_for: "dot-product and general scoring" }
  - { id: ResNet, title: "Deep Residual Learning for Image Recognition (He et al., 2015)", url: "https://arxiv.org/abs/1512.03385", used_for: "residual connections" }
  - { id: LayerNorm, title: "Layer Normalization (Ba et al., 2016)", url: "https://arxiv.org/abs/1607.06450", used_for: "the layer normalization formula" }
  - { id: PreLN, title: "On Layer Normalization in the Transformer Architecture (Xiong et al., 2020)", url: "https://arxiv.org/abs/2002.04745", used_for: "pre-norm and post-norm" }
  - { id: RMSNorm, title: "Root Mean Square Layer Normalization (Zhang and Sennrich, 2019)", url: "https://arxiv.org/abs/1910.07467", used_for: "RMSNorm" }
  - { id: GLU, title: "GLU Variants Improve Transformer (Shazeer, 2020)", url: "https://arxiv.org/abs/2002.05202", used_for: "gated MLPs" }
  - { id: KeyValueMemories, title: "Transformer Feed-Forward Layers Are Key-Value Memories (Geva et al., 2020)", url: "https://arxiv.org/abs/2012.14913", used_for: "what the MLP stores" }
  - { id: Circuits, title: "A Mathematical Framework for Transformer Circuits (Elhage et al., 2021)", url: "https://transformer-circuits.pub/2021/framework/index.html", used_for: "the residual stream, additive heads" }
  - { id: GPT1, title: "Improving Language Understanding by Generative Pre-Training (Radford et al., 2018)", url: "https://cdn.openai.com/research-covers/language-unsupervised/language_understanding_paper.pdf", used_for: "decoder-only models, learned positions" }
  - { id: GPT2, title: "Language Models are Unsupervised Multitask Learners (Radford et al., 2019)", url: "https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf", used_for: "layer norm moved to the sublayer input, residual scaling" }
  - { id: RelPos, title: "Self-Attention with Relative Position Representations (Shaw et al., 2018)", url: "https://arxiv.org/abs/1803.02155", used_for: "relative positions" }
  - { id: RoFormer, title: "RoFormer: Enhanced Transformer with Rotary Position Embedding (Su et al., 2021)", url: "https://arxiv.org/abs/2104.09864", used_for: "rotary embeddings" }
  - { id: ALiBi, title: "Train Short, Test Long: Attention with Linear Biases (Press et al., 2021)", url: "https://arxiv.org/abs/2108.12409", used_for: "linear distance biases" }
  - { id: FlashAttention, title: "FlashAttention: Fast and Memory-Efficient Exact Attention (Dao et al., 2022)", url: "https://arxiv.org/abs/2205.14135", used_for: "exact attention with less memory traffic" }
  - { id: MemoryEfficient, title: "Self-attention Does Not Need O(n^2) Memory (Rabe and Staats, 2021)", url: "https://arxiv.org/abs/2112.05682", used_for: "attention in less memory" }
  - { id: SparseTransformer, title: "Generating Long Sequences with Sparse Transformers (Child et al., 2019)", url: "https://arxiv.org/abs/1904.10509", used_for: "sparse attention" }
  - { id: Longformer, title: "Longformer: The Long-Document Transformer (Beltagy et al., 2020)", url: "https://arxiv.org/abs/2004.05150", used_for: "windowed attention" }
  - { id: MQA, title: "Fast Transformer Decoding: One Write-Head is All You Need (Shazeer, 2019)", url: "https://arxiv.org/abs/1911.02150", used_for: "multi-query attention" }
  - { id: GQA, title: "GQA: Training Generalized Multi-Query Transformer Models (Ainslie et al., 2023)", url: "https://arxiv.org/abs/2305.13245", used_for: "grouped-query attention" }
  - { id: KVCache, title: "Hugging Face Transformers documentation: Caching", url: "https://huggingface.co/docs/transformers/main/en/cache_explanation", used_for: "the KV cache, its shapes and per-step cost" }
  - { id: Sinks, title: "Efficient Streaming Language Models with Attention Sinks (Xiao et al., 2023)", url: "https://arxiv.org/abs/2309.17453", used_for: "attention sinks" }
  - { id: JainWallace, title: "Attention is not Explanation (Jain and Wallace, 2019)", url: "https://arxiv.org/abs/1902.10186", used_for: "weights as explanations" }
  - { id: WiegreffePinter, title: "Attention is not not Explanation (Wiegreffe and Pinter, 2019)", url: "https://arxiv.org/abs/1908.04626", used_for: "the reply" }
checked: 2026-11-23
---

# Tip

Attention is the trick at the heart of the networks behind modern chatbots. Here it is without the math.

Imagine a room where each word of a sentence is a person. To work out what it means _here_, each person asks the others a question and listens to the answers.

Every word does three things. It writes a **question** on a card: what am I looking for? It wears a **badge**: what am I about? And it keeps a **note** in its pocket: what would I hand over if you asked?

A word compares its question with every badge in the room. The better a badge matches, the more attention the word pays to its owner. Then it takes each owner's note, in proportion to how well the badge matched, and blends them. That blend is the word's new meaning, now colored by its neighbors.

In "The cat sat", the word "sat" is looking for whoever did the sitting. The badge on "cat" matches best, so "sat" mostly copies the note from "cat".

**Where the picture stops being true.** Nobody decides to pay attention. The cards, badges and notes are lists of numbers, and "matching" is a multiplication. The model is never told what to look for. It finds out which questions help by training on a great deal of text.

A **transformer** runs many of these conversations side by side, lets each word think about the result on its own, and repeats the whole thing in a tall stack. Its one big cost is that every word talks to every other word. Double the length of the text and the number of conversations quadruples.

# Waterline

## The idea in one paragraph

A transformer turns a sequence of tokens (pieces of text, usually words or parts of words) into a sequence of vectors (lists of numbers), and it does so by letting every token read from the others. Each token makes a query, a key and a value from its own vector. It scores its query against every key, turns the scores into weights that add up to one, and takes the weighted sum of the values. Run several of these attentions at once, add the result back to the token's own vector, pass it through a small network, repeat that block many times, and you have the model behind modern language systems. Position has to be added by hand, because the arithmetic alone cannot tell first from last. And because every token scores against every other token, the cost grows with the square of the length.

## 1. The problem attention solves

A language model reads a sequence of **tokens**. To understand one token it often needs another that is far away. In "The trophy did not fit in the suitcase because it was too big", the word "it" means the trophy. A model that cannot connect those two words will guess.

Before 2017 a standard tool was the recurrent network. It reads tokens one at a time and carries a fixed-size summary forward, like a reader with one small notepad. Two things hurt. Everything the model knows about the past must fit in the notepad. And token 100 cannot be processed until token 99 is done, so the work cannot be spread over thousands of processor cores.

In 2014 a translation model learned to look back over the whole source sentence while writing each word, instead of relying on one summary [Bahdanau]. The mechanism is now called **attention**. In 2017 the authors of [Transformer] asked what happens if you drop the recurrence and keep only attention. The answer was the transformer.

Attention fixes both problems. Any token can read from any other token in a single step, however far apart they are. And all tokens can be processed at the same time, because none has to wait for another.

## 2. Queries, keys and values

At the start of a layer, each token is a **vector**: a list of $d$ numbers. The original model uses $d = 512$. Attention turns that one vector into three, using three learned **matrices** (grids of numbers) $W^Q$, $W^K$ and $W^V$:

$$q_i = x_i W^Q, \qquad k_i = x_i W^K, \qquad v_i = x_i W^V$$

The three have different jobs. The **query** $q_i$ is what token $i$ is looking for. The **key** $k_j$ is what token $j$ advertises. The **value** $v_j$ is what token $j$ hands over when it is chosen.

Why not one vector for all three? Because being easy to find and being useful once found are different things. A verb looks for a noun that could be its subject. The noun's key says "I am a candidate subject". Its value carries what the verb needs to know about it.

To compare a query with a key, attention uses the **dot product**: multiply the two vectors entry by entry, then add up. The result is large and positive when the vectors point the same way, near zero when they are unrelated, and negative when they point opposite ways.

![[diagram: 01-attention-weights | **One query reads from three tokens.** Each line joins the selected query to a token's key, and its thickness is the attention weight. Hover over, tap or focus a token on the left to change the query. These are the numbers of the worked example below.]]

This is **self-attention**: the queries, keys and values all come from the same sequence. The words "looking for" and "advertises" are our reading of what training produces. The model is given only the arithmetic and a training signal. Nobody tells $W^Q$ to look for subjects.

## 3. Scaled dot-product attention

Attention is four steps. For token $i$:

1. **Score** every token $j$: $s_{ij} = q_i \cdot k_j$.
2. **Scale** each score: $z_{ij} = s_{ij} / \sqrt{d_k}$, where $d_k$ is the length of a key vector.
3. **Softmax** the scores of the row: $a_{ij} = e^{z_{ij}} / \sum_l e^{z_{il}}$.
4. **Mix** the values: $o_i = \sum_j a_{ij}\, v_j$.

The **softmax** turns any list of numbers into positive numbers that add up to 1. The biggest score gets the biggest share, and it exaggerates gaps: scores $0$ and $1$ become weights $0.27$ and $0.73$, while scores $0$ and $5$ become $0.007$ and $0.993$. The $a_{ij}$ are the **attention weights**. Step 4 is a weighted average. If one weight is near 1, token $i$ copies that token's value. If the weights are equal, it takes the plain average.

For all tokens at once the four steps are one line, Equation 1 of [Transformer]:

$$\text{Attention}(Q, K, V) = \text{softmax}\!\left(\frac{Q K^{\top}}{\sqrt{d_k}}\right) V$$

$K^\top$ is $K$ with its rows and columns swapped, so $QK^\top$ holds every score at once: row $i$, column $j$ is $q_i \cdot k_j$. The softmax is applied to each row.

![[diagram: 02-attention-pipeline | **Scaled dot-product attention, with shapes.** $n$ is the number of tokens. The score matrix has one row and one column for every token, so it is $n \times n$. Everything about the cost of attention comes from that square.]]

Step 2 looks like a detail, and it is not. Dot products of longer vectors are bigger. Big scores make the softmax nearly one-sided, and a nearly one-sided softmax hardly reacts to small changes, so learning stalls. Dividing by $\sqrt{d_k}$ keeps the spread of the scores the same whatever the width. The Deep layer shows why the factor is a square root.

## 4. Many heads, and knowing where you are

One attention gives each token one set of weights. But a token may need several things at once: its subject, the word before it, the bracket it closes. So the model runs several attentions side by side. Each is a **head**, with its own $W^Q$, $W^K$ and $W^V$, working in a smaller space. The heads' outputs are joined end to end and mixed by one more matrix, $W^O$. The original model has $h = 8$ heads with $d_k = d_v = 64$, so $8 \times 64 = 512 = d$, and eight heads cost about as much as one head of full width.

![[diagram: 03-multi-head | **Multi-head attention.** Each head runs the attention of the last figure on its own slice of the width. The outputs are joined, then mixed by $W^O$, so the result has the same shape as the input.]]

Attention has a blind spot. Shuffle the tokens and every token still gets the same query, key and value, because nothing in the formulas says where a token sits. So the outputs are the same ones, shuffled. "dog bites man" and "man bites dog" would look alike. The model has to be told where each token is.

The original fix is to add a **position vector** to each token's vector before the first layer. Each position gets a pattern of numbers made of sines and cosines that repeat at many different speeds. Think of a clock with many hands: the fast hand tells neighbors apart, the slow hand tells early from late, and together they give every position a unique reading. Because position is now part of the token's own vector, attention can learn to use it. In the paper's tests, vectors learned during training worked about as well as the sinusoids [Transformer].

## 5. The transformer block

Attention moves information between tokens. A full **block** adds three more pieces, and a transformer is a stack of such blocks.

**Residual connection.** A step does not replace a token's vector. It adds to it: the output is the input plus what the step computed, $y = x + F(x)$. The token's vector is a running total, and each step adds a correction. The original information passes through untouched, and the training signal has a direct path back through the stack. Working on images, [ResNet] reported that deep networks were easier to optimize when each layer learned a correction to its input instead of a whole new answer.

**MLP.** After attention, each token's vector goes through a small network, a multi-layer perceptron. It is two matrix multiplications with a simple nonlinear function between them. The original widens the vector from $d = 512$ to $2048$ and back. The same weights are used for every token, and the tokens do not interact in it. Attention gathers information. The MLP computes with what was gathered.

**Normalization.** Layer normalization rescales one token's vector so that its entries have mean 0 and variance 1, then applies a learned gain and shift. Without it, numbers can grow or shrink as they pass through many layers.

The original paper normalizes after the addition. [GPT2] moved the normalization to the input of each sublayer and added one more after the final block. The figure shows that arrangement.

![[diagram: 04-transformer-block | **One transformer block.** The thick line is the vector of a token as it passes through; it is never replaced, only added to. Attention is the only place where tokens exchange information. The block is repeated: the original model stacks 6 in its encoder and 6 in its decoder, and [GPT1] stacks 12.]]

## 6. Masking, and the cost of length

A language model predicts the next token. During training it sees a whole sentence at once, and every position makes its own prediction. If token $i$ could read token $i+1$, it would only need to copy the answer, and it would learn nothing useful. So attention is **masked**: token $i$ may read only tokens $1, \dots, i$.

The mask works on the scores. Before the softmax, every score for a forbidden pair is set to $-\infty$. Since $e^{-\infty} = 0$, those pairs get weight exactly 0, and the allowed weights still add up to 1. On the grid of scores, the allowed pairs are a triangle. This is **causal** masking, and it makes the model read left to right.

Now the cost. For each head in each layer, the grid of scores has $n \times n$ entries. Computing it takes about $n^2 d_k$ multiplications, and storing it takes $n^2$ numbers. Double the length and the grid has four times as many entries. Everything else in the block, the projections and the MLP, grows only in proportion to $n$.

![[diagram: 05-causal-mask | **The scores of one head, and the mask.** Each row is a token asking. Each column is a token it could read. Lit cells are allowed by the causal mask. Move the slider: the number of scores grows with the square of the length, so the cost does too.]]

Here are real sizes, if the whole grid of one head in one layer is stored at 2 bytes per score:

| Length $n$ | Scores, $n^2$ | Stored |
| --- | --- | --- |
| 1,000 | $10^6$ | 2 MB |
| 10,000 | $10^8$ | 200 MB |
| 100,000 | $10^{10}$ | 20 GB |

That is why long inputs are expensive, and why much of the work on making transformers faster is about this grid.

> **Note.** The table assumes the whole grid is stored. Some implementations never store it; the Abyss layer says how.

## Worked example

Take the sentence "The cat sat": three tokens, with keys of length $d_k = 2$ so the numbers stay small. Suppose the projections have already run and produced these vectors:

| Token | Query $q$ | Key $k$ | Value $v$ |
| --- | --- | --- | --- |
| The | $(1, 0)$ | $(0, 1)$ | $(1, 0)$ |
| cat | $(0, 1)$ | $(2, 0)$ | $(0, 2)$ |
| sat | $(2, 1)$ | $(1, 1)$ | $(2, 2)$ |

We compute what "sat" reads, using its query $q = (2, 1)$.

**Step 1: score.** Take the dot product of $q$ with each key.

$$q \cdot k_{\text{The}} = 2\cdot 0 + 1 \cdot 1 = 1, \qquad q \cdot k_{\text{cat}} = 2 \cdot 2 + 1 \cdot 0 = 4, \qquad q \cdot k_{\text{sat}} = 2 \cdot 1 + 1 \cdot 1 = 3$$

**Step 2: scale.** $\sqrt{d_k} = \sqrt{2} \approx 1.414$, so the scores $1, 4, 3$ become $0.707,\ 2.828,\ 2.121$.

**Step 3: softmax.** Exponentiate each: $e^{0.707} = 2.028$, $e^{2.828} = 16.919$, $e^{2.121} = 8.342$. They add up to $27.289$. Divide each by that total:

$$a = (0.0743,\ 0.6200,\ 0.3057)$$

The weights add up to 1. "sat" puts 62% of its attention on "cat".

**Step 4: mix.** Take the weighted sum of the values.

$$o = 0.0743\,(1, 0) + 0.6200\,(0, 2) + 0.3057\,(2, 2) = (0.6857,\ 1.8514)$$

Check each coordinate. First: $0.0743 \cdot 1 + 0.3057 \cdot 2 = 0.0743 + 0.6114 = 0.6857$. Second: $0.6200 \cdot 2 + 0.3057 \cdot 2 = 1.2400 + 0.6114 = 1.8514$. The new vector for "sat" is mostly the value of "cat", with a little of "sat" and "The" mixed in. The first figure shows the same computation: select "sat" and its weights match these, rounded to two places.

## Check yourself

<details>
<summary>In the worked example, suppose the query of "sat" were $(0, 0)$ instead of $(2, 1)$. What would its attention weights and its output be?</summary>

Every score is $(0,0) \cdot k = 0$, so the softmax gives equal weights $(\tfrac13, \tfrac13, \tfrac13)$. The output is the plain average of the three values: $\left(\tfrac{1+0+2}{3},\ \tfrac{0+2+2}{3}\right) = (1,\ 1.333)$.
</details>

<details>
<summary>Why are the scores divided by $\sqrt{d_k}$ and not by $d_k$ or left alone?</summary>

If the entries of $q$ and $k$ are independent with mean 0 and variance 1, then $q \cdot k$ has variance $d_k$ and standard deviation $\sqrt{d_k}$. Left alone, wide keys give scores with a wide spread, and the softmax goes nearly one-sided. Dividing by $\sqrt{d_k}$ brings the variance back to 1. Dividing by $d_k$ would shrink the spread to $1/\sqrt{d_k}$, which makes the weights too flat.
</details>

<details>
<summary>You shuffle the order of the input tokens, with no position information added. What happens to the outputs of an attention layer?</summary>

The outputs are the same vectors, shuffled in the same way. Each token's query, key and value depend only on that token, and its output is a weighted sum over all tokens, which does not depend on their order. So the model cannot tell "dog bites man" from "man bites dog" unless position is added.
</details>

<details>
<summary>In a transformer block, which part exchanges information between tokens, and which parts work on each token alone?</summary>

Only attention exchanges information between tokens. The MLP and the normalization act on each token's vector separately, with the same weights for every token. The residual connection adds each step's output to the existing vector instead of replacing it.
</details>

<details>
<summary>A model reads 8,000 tokens, and you double the input to 16,000. By what factor do the attention scores per head per layer, and the MLP work, grow?</summary>

The scores grow by a factor of 4: from $8000^2 = 64{,}000{,}000$ to $16000^2 = 256{,}000{,}000$. The MLP works on each token separately, so its work grows by a factor of 2.
</details>

## References

# Deep

## 1. How attention compares with recurrence and convolution

[Transformer] compares three ways to connect the tokens of a sequence. Here $n$ is the sequence length and $d$ is the width of each token's vector.

| Layer type | Work per layer | Steps that must run in order | Longest path between two tokens |
| --- | --- | --- | --- |
| Self-attention | $O(n^2 \cdot d)$ | $O(1)$ | $O(1)$ |
| Recurrent | $O(n \cdot d^2)$ | $O(n)$ | $O(n)$ |
| Convolutional, kernel width $k$ | $O(k \cdot n \cdot d^2)$ | $O(1)$ | $O(\log_k n)$ |

Read the last two columns first. They are why attention won: a signal, and the gradient that trains it, must travel along that path, so a shorter path leaves less room for it to fade. The first column is the price. Work grows with $n^2$. It is below the recurrent layer's $n \cdot d^2$ only while $n < d$, and for the long inputs of today the comparison goes the other way.

## 2. Shapes, and the other kinds of attention

Stack the $n$ tokens as the rows of a matrix $X$ with $n$ rows and $d$ columns. Then the three projections are three matrix products: $Q = XW^Q$, $K = XW^K$, $V = XW^V$. In the original model $W^Q$ and $W^K$ are $d \times d_k$ and $W^V$ is $d \times d_v$. Queries and keys must have the same length, because they are multiplied together. Values may differ.

Self-attention is one of three uses of attention in the 2017 model. In **encoder–decoder attention** the queries come from the previous decoder layer, while the keys and values come from the output of the encoder. Models in the GPT line have no encoder at all. [GPT1] describes "a 12-layer decoder-only transformer with masked self-attention heads", and masked self-attention is what the Waterline's last section explains.

## 3. Why the square root

The footnote in [Transformer] argues as follows. Suppose the entries of $q$ and $k$ are independent random numbers with mean 0 and variance 1. Each product $q_t k_t$ then has mean 0 and variance $E[q_t^2]\,E[k_t^2] = 1$. The dot product is a sum of $d_k$ independent products, so

$$q \cdot k = \sum_{t=1}^{d_k} q_t k_t \quad\text{has mean } 0 \text{ and variance } d_k.$$

The standard deviation is $\sqrt{d_k}$. Dividing by $\sqrt{d_k}$ brings the variance back to 1, whatever $d_k$ is. A different factor would leave the spread growing or shrinking with the width.

Why a wide spread is bad: the softmax's slope is $\partial a_i / \partial z_j = a_i(\delta_{ij} - a_j)$, where $\delta_{ij}$ is 1 when $i = j$ and 0 otherwise. If one weight is close to 1 and the rest close to 0, every one of those slopes is close to 0. The paper puts it as pushing the softmax "into regions where it has extremely small gradients", and the gradients are what train $W^Q$ and $W^K$.

![[diagram: 06-scaling | **The same scores, with and without scaling.** The six scores are fixed draws from a standard normal distribution. Without scaling each is multiplied by $\sqrt{d_k}$, which is what happens to the spread of real dot products. Move the slider to widen the key vectors: the unscaled weights collapse onto one token, and the scaled ones do not move.]]

The scaling is a **temperature**. Dividing every score by a number $\tau$ before the softmax makes the weights sharper when $\tau$ is small and flatter when it is large. As $\tau \to 0$ the softmax puts all its weight on the largest score, as an argmax would. As $\tau \to \infty$ it spreads the weight evenly. Choosing $\tau = \sqrt{d_k}$ is choosing the temperature at which the spread of the scores stays put as the width changes. The slider in the figure moves the unscaled temperature the other way: a wider key is a colder softmax.

The paper also reports that additive attention beat dot-product attention _without scaling_ for larger $d_k$. With the scaling, dot products keep their speed advantage.

## 4. The worked example as matrices, with and without the mask

Stack the rows of the worked example. All the scores at once are $QK^\top$, and the third row is the one computed in the Waterline:

$$QK^\top = \begin{pmatrix} 0 & 2 & 1 \\ 1 & 0 & 1 \\ 1 & 4 & 3 \end{pmatrix}$$

Divide by $\sqrt{2}$, then apply the softmax to each row. Rounded to three places:

$$A = \begin{pmatrix} 0.140 & 0.576 & 0.284 \\ 0.401 & 0.198 & 0.401 \\ 0.074 & 0.620 & 0.306 \end{pmatrix}, \qquad AV = \begin{pmatrix} 0.708 & 1.720 \\ 1.203 & 1.198 \\ 0.686 & 1.851 \end{pmatrix}$$

Each row of $A$ adds up to 1. Skip the scaling and the softmax of $(1, 4, 3)$ is $(0.035, 0.705, 0.260)$, sharper than $(0.074, 0.620, 0.306)$. With two-entry vectors the effect is small. With $d_k = 64$ it is not.

Now add the causal mask. "The" may see only itself and "cat" may see only "The" and itself. Row 1 becomes $(1, 0, 0)$ and its output is $(1, 0)$. Row 2 uses only the first two scores, $0.707$ and $0$, so its weights are $(0.670, 0.330, 0)$ and its output is $(0.670, 0.660)$. Row 3 does not change, because the last token may see everyone.

## 5. Multi-head and position, exactly

$$\text{head}_i = \text{Attention}(XW_i^Q,\ XW_i^K,\ XW_i^V), \qquad \text{MultiHead} = \text{Concat}(\text{head}_1, \dots, \text{head}_h)\,W^O$$

Here $W_i^Q, W_i^K \in \mathbb{R}^{d \times d_k}$, $W_i^V \in \mathbb{R}^{d \times d_v}$ and $W^O \in \mathbb{R}^{h d_v \times d}$. With $d_k = d_v = d/h$, the projections of all heads hold $3d^2$ weights and $W^O$ holds $d^2$, so attention has $4d^2$ weights in total, ignoring biases. That is the same as one head of full width. For $d = 512$ it is $4 \times 512^2 = 1{,}048{,}576$.

The sinusoidal position encoding of [Transformer] is

$$PE_{(pos,\,2i)} = \sin\!\left(\frac{pos}{10000^{2i/d}}\right), \qquad PE_{(pos,\,2i+1)} = \cos\!\left(\frac{pos}{10000^{2i/d}}\right)$$

Dimensions $2i$ and $2i+1$ form a sine and cosine pair whose wavelength is $2\pi \cdot 10000^{2i/d}$. The wavelengths form a geometric progression from $2\pi$ up to $10000 \cdot 2\pi$. The authors chose this form because they hypothesized it would make relative positions easy to learn: for any fixed offset $k$, $PE_{pos+k}$ can be written as a linear function of $PE_{pos}$. In each pair, moving $k$ positions rotates the pair by a fixed angle, and a rotation is a linear map. They also hoped it would let the model extrapolate to sequences longer than those seen in training.

![[diagram: 07-position-encoding | **Four dimensions of the sinusoidal position encoding** for positions 0 to 40, with $d = 64$. Dimension 0 repeats every 6 positions or so. Dimension 24 has barely started its first cycle. Together the dimensions tell every position apart.]]

## 6. The block, exactly

Layer normalization takes one token's vector $a$ of $H$ entries and computes [LayerNorm]

$$\mu = \frac{1}{H}\sum_{i=1}^{H} a_i, \qquad \sigma = \sqrt{\frac{1}{H}\sum_{i=1}^{H}(a_i - \mu)^2}, \qquad y_i = g_i\,\frac{a_i - \mu}{\sigma} + b_i$$

where $g$ and $b$ are learned. (Implementations add a tiny constant under the square root to avoid dividing by zero.) The two arrangements of the norm are:

$$\underbrace{y = \text{LN}\big(x + F(x)\big)}_{\text{post-norm (2017)}} \qquad\qquad \underbrace{y = x + F\big(\text{LN}(x)\big)}_{\text{pre-norm (GPT-2)}}$$

[PreLN] analyzed both at the start of training. For the last feed-forward layer, the gradient is bounded by $O(d\sqrt{\ln d})$ with post-norm and by $O(d\sqrt{\ln d\,/\,L})$ with pre-norm, where $L$ is the number of layers. In their experiments, pre-norm models trained without the usual learning-rate warm-up reached comparable results with less training time. Their bounds rest on simplifying assumptions, and their finding is for the tasks they tried.

Where the weights are. With a hidden width of $4d$, attention has $4d^2$ weights and the MLP has $2 \cdot d \cdot 4d = 8d^2$, ignoring biases. For $d = 512$ that is $1{,}048{,}576$ and $2{,}097{,}152$. Two thirds of a block's weights are in the MLP.

[Circuits] describes the running total as the **residual stream**: the sum of the original embedding and the output of every previous layer. Every attention head and every MLP reads from it and adds back to it. Concatenating the heads and multiplying by $W^O$ is the same as giving each head its own slice of $W^O$ and adding the results:

$$\text{Concat}(\text{head}_1, \dots, \text{head}_h)\,W^O = \sum_{i=1}^{h} \text{head}_i\, W^O_i$$

where $W^O_i$ is the block of $d_v$ rows that multiplies head $i$. So each head writes its own contribution into the stream, and the contributions add. "Independent" here describes how the computation decomposes. It does not mean the heads learn unrelated things.

## 7. The mask in code, and a cache for generating

In the formula the mask is a matrix $M$ added to the scores: it holds 0 where reading is allowed and $-\infty$ where it is not.

$$\text{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}} + M\right)V$$

Here is the whole of it in NumPy:

```python
import numpy as np

def attention(Q, K, V, causal=True):
    n, d_k = Q.shape
    scores = Q @ K.T / np.sqrt(d_k)                    # n x n
    if causal:
        allowed = np.tril(np.ones((n, n), dtype=bool))  # lower triangle
        scores = np.where(allowed, scores, -np.inf)
    scores = scores - scores.max(axis=-1, keepdims=True)  # stable softmax
    weights = np.exp(scores)
    weights /= weights.sum(axis=-1, keepdims=True)
    return weights @ V, weights
```

Called with the $Q$, $K$ and $V$ of the worked example, `causal=False` returns the matrices $A$ and $AV$ above, and `causal=True` returns the masked weights and outputs.

Counting multiplications: $QK^\top$ takes $n^2 d_k$ per head, and weights times $V$ takes $n^2 d_v$ more. Over $h$ heads, with $h\,d_k = h\,d_v = d$, that is about $2n^2 d$ per layer. Table 1 of [Transformer] writes the order as $O(n^2 \cdot d)$.

When generating text there is a shortcut. The mask means a token's vector in every layer depends only on the tokens before it, so the keys and values of earlier tokens do not change when a new token arrives. The model keeps them in a **KV cache**. A new step computes one new query, key and value per layer and reads against the cache. The documentation in [KVCache] states that, with the cache, attention cost per step is linear in the length so far. Summed over a whole generation, the work is still quadratic.

The cache costs memory. For $L$ layers, batch size $B$, length $T$, $H_{kv}$ key and value heads of width $d_{head}$, and $s$ bytes per number, the keys and values together take

$$2 \cdot L \cdot B \cdot T \cdot H_{kv} \cdot d_{head} \cdot s \text{ bytes.}$$

This follows from the shapes of the cached tensors, `[batch, heads, length, head_dim]` for keys and for values in every layer [KVCache]. Take a model with 32 layers and 32 heads of width 128, 16-bit numbers, one sequence of 4096 tokens: $2 \cdot 32 \cdot 1 \cdot 4096 \cdot 32 \cdot 128 \cdot 2 = 2{,}147{,}483{,}648$ bytes, or 2 GiB for one sequence.

# Abyss

## 1. Attention before the transformer, and other ways to score

[Bahdanau] scored a decoder state $s$ against each encoder state $h_j$ with a small feed-forward network: $a(s, h_j) = v_a^\top \tanh(W_a s + U_a h_j)$. This is called **additive** attention. [Luong] compared simpler scores: a plain dot product, $h_t^\top \bar{h}_s$, and a "general" form with a matrix in the middle, $h_t^\top W_a \bar{h}_s$.

The transformer uses a dot product. Scoring every pair is then one matrix multiplication, $QK^\top$, which is exactly what accelerators are built to do quickly. The sources above describe attention for translation; none of them is a claim about where the idea of weighting inputs first appeared, and this lecture makes no such claim.

## 2. Attention weights are not explanations

It is tempting to read the weights as "what the model looked at". Be careful.

[JainWallace] found that, in the language models they tested, attention weights often did not track how much each input mattered to the prediction, and that quite different weights could give the same answer. They concluded that attention should not be treated as an explanation. [WiegreffePinter] replied that the answer depends on what you mean by "explanation", and that the earlier work does not show attention is useless for it. The first paper's experiments centered on particular tasks and mainly recurrent networks, so neither settles the question for a modern transformer.

Two facts from the Waterline point the same way. Each head's output is mixed with the other heads' and then rewritten by every later layer. And the weights must add up to one, so a head with nothing useful to read still has to put its weight somewhere. [Sinks] observed that the first tokens of a text often receive large attention scores even when they are not semantically important, and called them attention sinks.

> **Common mistake.** Reading a heat map of one head in one layer as an account of why the model produced its answer. It shows where that head read from, once, before many more steps.

## 3. What the square-root argument does not say

The argument assumes independent entries with zero mean and unit variance. That describes a random starting point. After training, queries and keys are correlated, and some heads become sharp on purpose. The factor $1/\sqrt{d_k}$ is a constant chosen so that training starts well behaved. It is not a measurement of trained scores.

A second matter is arithmetic. Subtracting the same number from every score in a row does not change the softmax, so implementations subtract the row's maximum before exponentiating. They need to: the largest 16-bit floating-point number is 65,504, and $e^{12} \approx 162{,}755$ already exceeds it.

A third is the mask. If every score in a row is $-\infty$, the softmax computes $0/0$ and returns not-a-number. A padding mask can produce such a row, so real implementations have to handle it, and libraries do so in different ways.

## 4. Other ways to say where a token is

- **Learned absolute positions.** [GPT1] states that it uses "learned position embeddings instead of the sinusoidal version proposed in the original work".
- **Relative positions in the score.** [RelPos] add a learned vector for each offset $j - i$, clipped to a maximum distance, to the keys and to the values.
- **Rotary embeddings (RoPE).** [RoFormer] rotate each query and key by an angle proportional to its position, pairing up coordinates, with frequencies $\theta_i = 10000^{-2(i-1)/d}$. The score between a query at position $m$ and a key at position $n$ then depends on the offset $n - m$ and not on the two positions separately: $q_m^\top k_n = x_m^\top W_q^\top R_{\Theta,\,n-m} W_k\, x_n$.
- **ALiBi.** [ALiBi] adds no position vectors at all. It subtracts from each score a penalty that grows with distance, with a different slope for each head: $\text{softmax}(q_i K^\top + m\cdot[-(i-1), \dots, -2, -1, 0])$. The authors report that a 1.3-billion-parameter model trained on length 1024 matched the perplexity of a sinusoidal model trained on length 2048, when both were tested at 2048, while training 11% faster and using 11% less memory. That is a result for their setup. It does not show that any method extrapolates in general.

## 5. Variants of the block

- **RMSNorm** [RMSNorm] drops the mean: $\bar{a}_i = g_i\, a_i / \text{RMS}(a)$ with $\text{RMS}(a) = \sqrt{\tfrac{1}{n}\sum_i a_i^2}$. It removes one statistic and the centering step, and keeps the rescaling.
- **Gated MLPs.** [GLU] replaced the first matrix and nonlinearity with a gate: $\text{FFN}_{\text{SwiGLU}} = (\text{Swish}_1(xW) \otimes xV)\,W_2$, where $\otimes$ multiplies entry by entry. That needs three matrices instead of two, so the hidden width was cut to two thirds of its old value to keep the parameter count equal (3072 to 2048 in the T5 experiments). The two-thirds rule matches the parameters in that paper. It is not a law.
- **Initialization.** [GPT2] scales the weights of the residual layers at initialization by $1/\sqrt{N}$, where $N$ is the number of residual layers, so that a deep stack does not start with a large running total.
- **What the MLP stores.** [KeyValueMemories] argue that feed-forward layers work like key–value memories: each key in the first matrix responds to a pattern in the input, and the matching value in the second matrix pushes the output toward certain next words. Their comparison with a neural memory leaves out the softmax that such memories usually apply to the match, which the real layer does not have.

## 6. Cheaper attention, and what each trade gives up

- **FlashAttention** [FlashAttention] computes exactly the same result. The standard implementation writes the $n \times n$ matrices to the GPU's main memory, taking $O(n^2)$ memory, and the time goes on moving them. FlashAttention splits the work into tiles that fit in fast on-chip memory and recomputes pieces when needed. It needs only $O(n)$ extra memory, but the arithmetic is still $O(n^2 d)$. It saves memory traffic, not multiplications. The paper's block-sparse variant, by contrast, is approximate.
- **Less memory, same time.** [MemoryEfficient] show attention can run in $O(\log n)$ memory, and their practical implementation uses $O(\sqrt{n})$. The time is still $O(n^2)$.
- **Fewer pairs.** Sparse and windowed attention compute only some of the scores. [SparseTransformer] get $O(n\sqrt{n})$ with fixed sparse patterns, and [Longformer] gets $O(n \cdot w)$ for a window of width $w$. Both change which tokens can read which, so they are not the same function as full attention.
- **A smaller cache.** Multi-query attention [MQA] has all heads share one set of keys and values. Grouped-query attention [GQA] shares one set per group of heads. The GQA paper says going from full multi-head to multi-query reduces the cache by a factor of the number of heads.

What is established here is each method's cost, as its paper states it. How much quality each gives up at the scale of today's models depends on the model and the task, and the papers measure only the cases they tried.
