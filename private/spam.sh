#!/bin/bash

for n in $(seq $1); do
    echo Spam $n
    n=$(($n + 1))
done