---
layout: page
permalink: /about/index.html
title: Sherry Yin
tags: [Sherry, Yin, Xi]
imagefeature: fourseasons.jpg
chart: true
---
<figure>
  <img src="{{ site.url }}/images/female-developer-background_665280-9660.avif" alt="Sherry Yin">
  <figcaption>Sherry Yin</figcaption>
</figure>

{% assign total_words = 0 %}
{% assign total_readtime = 0 %}
{% assign featuredcount = 0 %}
{% assign statuscount = 0 %}

{% for post in site.posts %}
    {% assign post_words = post.content | strip_html | number_of_words %}
    {% assign readtime = post_words | append: '.0' | divided_by:200 %}
    {% assign total_words = total_words | plus: post_words %}
    {% assign total_readtime = total_readtime | plus: readtime %}
    {% if post.featured %}
    {% assign featuredcount = featuredcount | plus: 1 %}
    {% endif %}
{% endfor %}


I'm **Sherry Yin**, a database and infrastructure engineer based in Singapore.

I work on distributed databases and cloud-native infrastructure: TiDB and its ecosystem (TiCDC, TiDB Operator), Kubernetes, object storage such as MinIO, logging pipelines, and TLS and security hardening.

The posts here are my notes from that work. There are currently {{ site.posts | size }} posts, about <span class="time">{{ total_readtime | round }}</span> minutes of reading in total. The most recent is {% for post in site.posts limit:1 %}<a href="{{ site.url }}{{ post.url }}">"{{ post.title }}"</a>, published on <time datetime="{{ post.date | date_to_xmlschema }}" class="post-time">{{ post.date | date: "%d %b %Y" }}</time>{% endfor %}.


**Say hello:** you can reach me at [{{ site.owner.email }}](mailto:{{ site.owner.email }}).
