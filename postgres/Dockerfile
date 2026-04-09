FROM pgvector/pgvector:pg16

# Install Chinese full-text search extensions:
#   - pg_jieba (preferred, jieba-based, active dictionary)
#   - zhparser (fallback, SCWS-based)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential \
       postgresql-server-dev-16 \
       ca-certificates \
       git \
       cmake \
       wget \
    # Build SCWS + zhparser
    && wget -q -O /tmp/scws.tar.bz2 http://www.xunsearch.com/scws/down/scws-1.2.3.tar.bz2 \
    && cd /tmp && tar xjf scws.tar.bz2 \
    && cd /tmp/scws-1.2.3 && ./configure && make && make install \
    && ldconfig \
    && git clone --depth 1 https://github.com/amutu/zhparser.git /tmp/zhparser \
    && cd /tmp/zhparser && make && make install \
    # Build pg_jieba
    && git clone --depth 1 --recursive https://github.com/jaiminpan/pg_jieba.git /tmp/pg_jieba \
    && cd /tmp/pg_jieba && mkdir build && cd build \
    && cmake -DPostgreSQL_TYPE_INCLUDE_DIR=/usr/include/postgresql/16/server .. \
    && make && make install \
    # Cleanup
    && apt-get purge -y --auto-remove build-essential postgresql-server-dev-16 git cmake wget \
    && rm -rf /var/lib/apt/lists/* /tmp/zhparser /tmp/scws* /tmp/pg_jieba

# pg_jieba requires preloading at startup
RUN echo "shared_preload_libraries = 'pg_jieba'" >> /usr/share/postgresql/postgresql.conf.sample
