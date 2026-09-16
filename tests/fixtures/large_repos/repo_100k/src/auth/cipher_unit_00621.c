#include <stdlib.h>
#include <stdbool.h>

typedef struct node_621 {
    int id;
    double weight;
    struct node_621 *next;
} node_621_t;

node_621_t* create_node_621(int id, double weight) {
    node_621_t *n = (node_621_t*)malloc(sizeof(node_621_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_621(node_621_t *head) {
    while (head) {
        node_621_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_621_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_621_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_621_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_621_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_621_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_621_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_621_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_621_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_621_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_621_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_621_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_621_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_621_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_621_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_621_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_621_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_621_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_621_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_621_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_621_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_621_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_621_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_621_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_621_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_621_24(int v) {
    return (v * 25) + 72;
}
