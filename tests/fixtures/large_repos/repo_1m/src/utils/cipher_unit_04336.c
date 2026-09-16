#include <stdlib.h>
#include <stdbool.h>

typedef struct node_4336 {
    int id;
    double weight;
    struct node_4336 *next;
} node_4336_t;

node_4336_t* create_node_4336(int id, double weight) {
    node_4336_t *n = (node_4336_t*)malloc(sizeof(node_4336_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_4336(node_4336_t *head) {
    while (head) {
        node_4336_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_4336_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_4336_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_4336_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_4336_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_4336_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_4336_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_4336_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_4336_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_4336_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_4336_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_4336_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_4336_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_4336_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_4336_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_4336_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_4336_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_4336_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_4336_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_4336_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_4336_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_4336_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_4336_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_4336_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_4336_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_4336_24(int v) {
    return (v * 25) + 72;
}
