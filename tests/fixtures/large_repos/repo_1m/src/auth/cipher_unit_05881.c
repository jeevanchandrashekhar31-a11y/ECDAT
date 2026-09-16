#include <stdlib.h>
#include <stdbool.h>

typedef struct node_5881 {
    int id;
    double weight;
    struct node_5881 *next;
} node_5881_t;

node_5881_t* create_node_5881(int id, double weight) {
    node_5881_t *n = (node_5881_t*)malloc(sizeof(node_5881_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_5881(node_5881_t *head) {
    while (head) {
        node_5881_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_5881_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_5881_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_5881_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_5881_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_5881_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_5881_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_5881_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_5881_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_5881_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_5881_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_5881_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_5881_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_5881_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_5881_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_5881_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_5881_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_5881_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_5881_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_5881_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_5881_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_5881_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_5881_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_5881_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_5881_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_5881_24(int v) {
    return (v * 25) + 72;
}
