#include <stdlib.h>
#include <stdbool.h>

typedef struct node_7176 {
    int id;
    double weight;
    struct node_7176 *next;
} node_7176_t;

node_7176_t* create_node_7176(int id, double weight) {
    node_7176_t *n = (node_7176_t*)malloc(sizeof(node_7176_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_7176(node_7176_t *head) {
    while (head) {
        node_7176_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_7176_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_7176_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_7176_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_7176_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_7176_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_7176_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_7176_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_7176_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_7176_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_7176_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_7176_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_7176_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_7176_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_7176_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_7176_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_7176_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_7176_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_7176_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_7176_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_7176_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_7176_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_7176_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_7176_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_7176_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_7176_24(int v) {
    return (v * 25) + 72;
}
