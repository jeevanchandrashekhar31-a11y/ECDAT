/*
 * Category: Negative Examples (Phase 22.3 Golden Corpus)
 * Pure standard C data structures and algorithms.
 * Must produce 0 findings (True Negatives).
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Node {
    int value;
    char description[64]; // 'description' contains 'des' substring
    struct Node *next;
} Node;

Node *create_node(int val, const char *desc) {
    Node *n = (Node *)malloc(sizeof(Node));
    if (n != NULL) {
        n->value = val;
        strncpy(n->description, desc, sizeof(n->description) - 1);
        n->description[sizeof(n->description) - 1] = '\0';
        n->next = NULL;
    }
    return n;
}

int binary_search(const int arr[], int size, int target) {
    int low = 0;
    int high = size - 1;
    while (low <= high) {
        int mid = low + (high - low) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    return -1;
}
