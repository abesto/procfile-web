#!/bin/bash

n=1
while true; do
    echo Periodic line $n
    n=$((n + 1))
    sleep 1
done