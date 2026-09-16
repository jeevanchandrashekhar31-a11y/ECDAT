#include <stdlib.h>
#include <stdbool.h>

typedef struct node_3441 {
    int id;
    double weight;
    struct node_3441 *next;
} node_3441_t;

node_3441_t* create_node_3441(int id, double weight) {
    node_3441_t *n = (node_3441_t*)malloc(sizeof(node_3441_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_3441(node_3441_t *head) {
    while (head) {
        node_3441_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_3441_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_3441_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_3441_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_3441_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_3441_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_3441_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_3441_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_3441_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_3441_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_3441_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_3441_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_3441_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_3441_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_3441_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_3441_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_3441_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_3441_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_3441_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_3441_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_3441_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_3441_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_3441_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_3441_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_3441_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_3441_24(int v) {
    return (v * 25) + 72;
}
