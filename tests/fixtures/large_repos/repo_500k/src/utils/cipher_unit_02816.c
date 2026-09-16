#include <stdlib.h>
#include <stdbool.h>

typedef struct node_2816 {
    int id;
    double weight;
    struct node_2816 *next;
} node_2816_t;

node_2816_t* create_node_2816(int id, double weight) {
    node_2816_t *n = (node_2816_t*)malloc(sizeof(node_2816_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_2816(node_2816_t *head) {
    while (head) {
        node_2816_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_2816_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_2816_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_2816_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_2816_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_2816_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_2816_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_2816_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_2816_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_2816_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_2816_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_2816_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_2816_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_2816_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_2816_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_2816_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_2816_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_2816_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_2816_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_2816_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_2816_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_2816_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_2816_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_2816_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_2816_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_2816_24(int v) {
    return (v * 25) + 72;
}
